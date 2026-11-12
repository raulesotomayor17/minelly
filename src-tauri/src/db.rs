use std::fs;
use std::io::copy as copy_reader;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use flate2::read::GzDecoder;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::books::book_name;
use crate::model::{
    CommentaryEntry, DictionaryEntry, EpubChapter, EpubChapterSummary, PbbBook,
    PbbCustomAttribute, PbbSourceRecord, Resource, ResourceKind, SearchHit, Verse,
};

pub struct Catalog {
    connection: Connection,
}

impl Catalog {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("no se pudo crear {}", parent.display()))?;
        }
        let connection = Connection::open(path)
            .with_context(|| format!("no se pudo abrir {}", path.display()))?;
        Self::from_connection(connection)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    pub(crate) fn connection(&self) -> &Connection {
        &self.connection
    }

    pub(crate) fn connection_mut(&mut self) -> &mut Connection {
        &mut self.connection
    }

    fn from_connection(connection: Connection) -> Result<Self> {
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;",
        )?;
        let catalog = Self { connection };
        catalog.migrate()?;
        Ok(catalog)
    }

    fn migrate(&self) -> Result<()> {
        self.connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS resources (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                abbreviation TEXT NOT NULL DEFAULT '',
                language TEXT NOT NULL DEFAULT '',
                source_format TEXT NOT NULL,
                source_path TEXT NOT NULL,
                verse_count INTEGER NOT NULL DEFAULT 0,
                entry_count INTEGER NOT NULL DEFAULT 0,
                imported_at INTEGER NOT NULL,
                metadata TEXT NOT NULL DEFAULT '{}',
                indexed INTEGER NOT NULL DEFAULT 0,
                search_priority INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS verses (
                resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
                book INTEGER NOT NULL,
                chapter INTEGER NOT NULL,
                verse INTEGER NOT NULL,
                html TEXT NOT NULL,
                PRIMARY KEY (resource_id, book, chapter, verse)
            );
            CREATE INDEX IF NOT EXISTS idx_verses_passage
                ON verses(resource_id, book, chapter, verse);

            CREATE TABLE IF NOT EXISTS commentary (
                resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
                book INTEGER NOT NULL,
                chapter_start INTEGER NOT NULL,
                verse_start INTEGER NOT NULL,
                chapter_end INTEGER NOT NULL,
                verse_end INTEGER NOT NULL,
                html TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_commentary_ref
                ON commentary(resource_id, book, chapter_start, chapter_end);

            CREATE TABLE IF NOT EXISTS dictionary (
                resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
                topic TEXT NOT NULL,
                html TEXT NOT NULL,
                PRIMARY KEY (resource_id, topic)
            );
            CREATE INDEX IF NOT EXISTS idx_dictionary_topic
                ON dictionary(resource_id, topic);

            CREATE TABLE IF NOT EXISTS epub_chapters (
                resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
                spine INTEGER NOT NULL,
                title TEXT NOT NULL,
                href TEXT NOT NULL,
                html TEXT NOT NULL,
                PRIMARY KEY (resource_id, spine)
            );
            CREATE INDEX IF NOT EXISTS idx_epub_chapters
                ON epub_chapters(resource_id, spine);

            CREATE TABLE IF NOT EXISTS interlinear_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                resource_id TEXT NOT NULL,
                book INTEGER NOT NULL,
                chapter INTEGER NOT NULL,
                verse INTEGER NOT NULL,
                word_order INTEGER NOT NULL,
                surface_text TEXT NOT NULL,
                original_manuscript TEXT NOT NULL,
                transliteration TEXT NOT NULL DEFAULT '',
                lemma TEXT NOT NULL DEFAULT '',
                strong_number TEXT NOT NULL DEFAULT '',
                morphology_code TEXT NOT NULL DEFAULT '',
                spanish_gloss TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_interlinear_reference
                ON interlinear_tokens(book, chapter, verse, word_order);
            CREATE INDEX IF NOT EXISTS idx_interlinear_resource
                ON interlinear_tokens(resource_id);

            CREATE TABLE IF NOT EXISTS strong_entries (
                id TEXT PRIMARY KEY,
                language TEXT NOT NULL,
                lemma TEXT NOT NULL DEFAULT '',
                transliteration TEXT NOT NULL DEFAULT '',
                pronunciation TEXT NOT NULL DEFAULT '',
                definition TEXT NOT NULL DEFAULT '',
                derivation TEXT NOT NULL DEFAULT '',
                kjv TEXT NOT NULL DEFAULT '',
                html TEXT NOT NULL,
                source TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS word_occurrences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                strong_number TEXT NOT NULL,
                book INTEGER NOT NULL,
                chapter INTEGER NOT NULL,
                verse INTEGER NOT NULL,
                word_order INTEGER NOT NULL,
                word TEXT NOT NULL,
                lemma TEXT NOT NULL DEFAULT '',
                transliteration TEXT NOT NULL DEFAULT '',
                morphology TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_word_occurrences_strong
                ON word_occurrences(strong_number, source, book, chapter, verse);
            CREATE INDEX IF NOT EXISTS idx_word_occurrences_ref
                ON word_occurrences(book, chapter, verse, word_order);

            CREATE TABLE IF NOT EXISTS word_study_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pbb_books (
                resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                resource_type TEXT NOT NULL DEFAULT 'Monograph',
                language TEXT NOT NULL DEFAULT 'es',
                author TEXT NOT NULL DEFAULT '',
                copyright TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                cover_path TEXT NOT NULL DEFAULT '',
                custom_attributes TEXT NOT NULL DEFAULT '[]',
                log_path TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'success',
                error_count INTEGER NOT NULL DEFAULT 0,
                warning_count INTEGER NOT NULL DEFAULT 0,
                cloud_synced INTEGER NOT NULL DEFAULT 0,
                hidden INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pbb_sources (
                resource_id TEXT NOT NULL REFERENCES pbb_books(resource_id) ON DELETE CASCADE,
                path TEXT NOT NULL,
                order_index INTEGER NOT NULL,
                modified INTEGER NOT NULL DEFAULT 0,
                size INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (resource_id, path)
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS pbb_fts USING fts5(
                resource_id UNINDEXED,
                chapter UNINDEXED,
                title,
                body,
                tokenize = 'unicode61'
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS global_search_index USING fts5(
                resource_id UNINDEXED,
                module_type UNINDEXED,
                reference_key UNINDEXED,
                content_text,
                tokenize = 'unicode61 remove_diacritics 1'
            );

            CREATE TABLE IF NOT EXISTS notebooks (
                id TEXT PRIMARY KEY,
                parent_id TEXT REFERENCES notebooks(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#5B95FF',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                notebook_id TEXT REFERENCES notebooks(id) ON DELETE SET NULL,
                title TEXT NOT NULL DEFAULT '',
                content_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id);

            CREATE TABLE IF NOT EXISTS highlights (
                id TEXT PRIMARY KEY,
                style_id TEXT NOT NULL DEFAULT 'yellow',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS note_tags (
                note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (note_id, tag_id)
            );

            CREATE TABLE IF NOT EXISTS anchors (
                id TEXT PRIMARY KEY,
                target_id TEXT NOT NULL,
                target_type TEXT NOT NULL,
                anchor_uri TEXT NOT NULL,
                exact_text TEXT NOT NULL DEFAULT '',
                start_offset INTEGER NOT NULL DEFAULT 0,
                end_offset INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                UNIQUE (target_id, target_type, anchor_uri)
            );
            CREATE INDEX IF NOT EXISTS idx_anchors_uri ON anchors(anchor_uri);
            CREATE INDEX IF NOT EXISTS idx_anchors_target ON anchors(target_id, target_type);

            CREATE TABLE IF NOT EXISTS sermons (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                series TEXT NOT NULL DEFAULT '',
                series_number INTEGER,
                topics TEXT NOT NULL DEFAULT '[]',
                passages TEXT NOT NULL DEFAULT '[]',
                tags TEXT NOT NULL DEFAULT '[]',
                speaker TEXT NOT NULL DEFAULT '',
                venue TEXT NOT NULL DEFAULT '',
                service TEXT NOT NULL DEFAULT '',
                date_time TEXT NOT NULL DEFAULT '',
                audience TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                content_json TEXT NOT NULL DEFAULT '{}',
                questions_json TEXT NOT NULL DEFAULT '[]',
                slide_settings_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sermons_date ON sermons(date_time);
            CREATE INDEX IF NOT EXISTS idx_sermons_series ON sermons(series);

            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                note_id UNINDEXED, notebook_id UNINDEXED, title, plain_body, tags_text,
                tokenize = 'unicode61 remove_diacritics 1'
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS sermons_fts USING fts5(
                sermon_id UNINDEXED, title, series, speaker, passages_text, topics_text,
                plain_body, tokenize = 'unicode61 remove_diacritics 1'
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS passage_ranges_rtree USING rtree_i32(
                id, start_verse_code, end_verse_code
            );
            CREATE TABLE IF NOT EXISTS learning_sessions (
                id TEXT PRIMARY KEY,
                goal_title TEXT NOT NULL,
                topic_category TEXT NOT NULL DEFAULT 'exegesis',
                stage TEXT NOT NULL DEFAULT 'measure',
                dependency_plan_json TEXT NOT NULL DEFAULT '[]',
                messages_json TEXT NOT NULL DEFAULT '[]',
                active_step_id TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS knowledge_propositions (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                claim TEXT NOT NULL,
                reasoning_premise TEXT NOT NULL DEFAULT '',
                related_refs_json TEXT NOT NULL DEFAULT '[]',
                related_strongs_json TEXT NOT NULL DEFAULT '[]',
                mastery_state TEXT NOT NULL DEFAULT 'learned',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS knowledge_edges (
                from_prop_id TEXT NOT NULL,
                to_prop_id TEXT NOT NULL,
                relation TEXT NOT NULL DEFAULT 'supports',
                PRIMARY KEY (from_prop_id, to_prop_id)
            );
            CREATE TABLE IF NOT EXISTS reading_progress (
                resource_id TEXT PRIMARY KEY,
                spine INTEGER NOT NULL DEFAULT 0,
                paragraph_index INTEGER NOT NULL DEFAULT 0,
                scroll_ratio REAL NOT NULL DEFAULT 0,
                completed_spines_json TEXT NOT NULL DEFAULT '[]',
                overall_percent REAL NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS book_bookmarks (
                id TEXT PRIMARY KEY,
                resource_id TEXT NOT NULL,
                spine INTEGER NOT NULL DEFAULT 0,
                paragraph_index INTEGER NOT NULL DEFAULT 0,
                scroll_ratio REAL NOT NULL DEFAULT 0,
                label TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                excerpt TEXT NOT NULL DEFAULT '',
                is_primary_ribbon INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_bookmarks_resource ON book_bookmarks(resource_id);
            CREATE TABLE IF NOT EXISTS passage_range_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                sub_id TEXT NOT NULL,
                reference_display TEXT NOT NULL,
                snippet TEXT NOT NULL
            );
            "#,
        )?;
        ensure_column(
            &self.connection,
            "anchors",
            "start_offset",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(
            &self.connection,
            "anchors",
            "end_offset",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(
            &self.connection,
            "sermons",
            "service",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        ensure_column(
            &self.connection,
            "sermons",
            "description",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        ensure_column(
            &self.connection,
            "sermons",
            "questions_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        ensure_column(
            &self.connection,
            "sermons",
            "slide_settings_json",
            "TEXT NOT NULL DEFAULT '{}'",
        )?;
        ensure_column(
            &self.connection,
            "resources",
            "indexed",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(
            &self.connection,
            "resources",
            "search_priority",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        for (table, column, definition) in [
            ("interlinear_tokens", "spanish_gloss", "TEXT NOT NULL DEFAULT ''"),
            ("reading_progress", "completed_items_json", "TEXT NOT NULL DEFAULT '[]'"),
            ("book_bookmarks", "bible_book", "INTEGER"),
            ("book_bookmarks", "bible_chapter", "INTEGER"),
            ("book_bookmarks", "bible_verse", "INTEGER"),
            ("book_bookmarks", "snippet", "TEXT NOT NULL DEFAULT ''"),
            ("book_bookmarks", "color", "TEXT NOT NULL DEFAULT '#d97706'"),
            ("notebooks", "node_type", "TEXT NOT NULL DEFAULT 'notebook'"),
            ("notebooks", "icon", "TEXT NOT NULL DEFAULT ''"),
            ("notebooks", "sort_order", "INTEGER NOT NULL DEFAULT 0"),
            ("notebooks", "origin_uuid", "TEXT"),
            ("notebooks", "shared_by", "TEXT NOT NULL DEFAULT ''"),
            ("notes", "origin_uuid", "TEXT"),
            ("notes", "author_name", "TEXT NOT NULL DEFAULT ''"),
            ("notes", "sort_order", "INTEGER NOT NULL DEFAULT 0"),
        ] {
            ensure_column(&self.connection, table, column, definition)?;
        }
        self.connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS note_links (
                source_note_id TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_key TEXT NOT NULL,
                PRIMARY KEY (source_note_id, target_type, target_key)
            );",
        )?;
        self.connection.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_bookmarks_bible
                ON book_bookmarks(resource_id, bible_book, bible_chapter, bible_verse);",
        )?;
        crate::indexer_v2::rebuild_aux_indexes(&self.connection)?;
        Ok(())
    }

    pub fn upsert_resource(&mut self, resource: &Resource) -> Result<()> {
        let metadata = serde_json::to_string(&resource.metadata)?;
        self.connection.execute(
            r#"
            INSERT INTO resources
                (id, kind, title, abbreviation, language, source_format, source_path,
                 verse_count, entry_count, imported_at, metadata)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(id) DO UPDATE SET
                kind=excluded.kind,
                title=excluded.title,
                abbreviation=excluded.abbreviation,
                language=excluded.language,
                source_format=excluded.source_format,
                source_path=excluded.source_path,
                verse_count=excluded.verse_count,
                entry_count=excluded.entry_count,
                imported_at=excluded.imported_at,
                metadata=excluded.metadata
            "#,
            params![
                resource.id,
                resource.kind.as_str(),
                resource.title,
                resource.abbreviation,
                resource.language,
                resource.source_format,
                resource.source_path,
                resource.verse_count,
                resource.entry_count,
                resource.imported_at,
                metadata,
            ],
        )?;
        Ok(())
    }

    pub fn replace_verses(&mut self, resource_id: &str, verses: &[Verse]) -> Result<()> {
        let tx = self.connection.transaction()?;
        tx.execute("DELETE FROM verses WHERE resource_id = ?1", [resource_id])?;
        {
            let mut insert = tx.prepare(
                "INSERT INTO verses (resource_id, book, chapter, verse, html)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for verse in verses {
                insert.execute(params![
                    resource_id,
                    verse.book,
                    verse.chapter,
                    verse.verse,
                    verse.html,
                ])?;
            }
        }
        tx.execute(
            "UPDATE resources SET verse_count = ?1 WHERE id = ?2",
            params![verses.len() as i64, resource_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn replace_commentaries(
        &mut self,
        resource_id: &str,
        entries: &[CommentaryEntry],
    ) -> Result<()> {
        let tx = self.connection.transaction()?;
        tx.execute(
            "DELETE FROM commentary WHERE resource_id = ?1",
            [resource_id],
        )?;
        {
            let mut insert = tx.prepare(
                "INSERT INTO commentary
                    (resource_id, book, chapter_start, verse_start, chapter_end, verse_end, html)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for entry in entries {
                insert.execute(params![
                    resource_id,
                    entry.book,
                    entry.chapter_start,
                    entry.verse_start,
                    entry.chapter_end,
                    entry.verse_end,
                    entry.html,
                ])?;
            }
        }
        tx.execute(
            "UPDATE resources SET entry_count = ?1 WHERE id = ?2",
            params![entries.len() as i64, resource_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn replace_dictionary(
        &mut self,
        resource_id: &str,
        entries: &[DictionaryEntry],
    ) -> Result<()> {
        let tx = self.connection.transaction()?;
        tx.execute(
            "DELETE FROM dictionary WHERE resource_id = ?1",
            [resource_id],
        )?;
        {
            let mut insert = tx.prepare(
                "INSERT OR REPLACE INTO dictionary (resource_id, topic, html)
                 VALUES (?1, ?2, ?3)",
            )?;
            for entry in entries {
                insert.execute(params![resource_id, entry.topic, entry.html])?;
            }
        }
        tx.execute(
            "UPDATE resources SET entry_count = ?1 WHERE id = ?2",
            params![entries.len() as i64, resource_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn replace_epub_chapters(
        &mut self,
        resource_id: &str,
        chapters: &[EpubChapter],
    ) -> Result<()> {
        let tx = self.connection.transaction()?;
        tx.execute(
            "DELETE FROM epub_chapters WHERE resource_id = ?1",
            [resource_id],
        )?;
        {
            let mut insert = tx.prepare(
                "INSERT INTO epub_chapters (resource_id, spine, title, href, html)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for chapter in chapters {
                insert.execute(params![
                    resource_id,
                    chapter.spine,
                    chapter.title,
                    chapter.href,
                    chapter.html,
                ])?;
            }
        }
        tx.execute(
            "UPDATE resources SET entry_count = ?1 WHERE id = ?2",
            params![chapters.len() as i64, resource_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn epub_chapters(&self, resource_id: &str) -> Result<Vec<EpubChapterSummary>> {
        let mut stmt = self.connection.prepare(
            "SELECT spine, title FROM epub_chapters
             WHERE resource_id = ?1 ORDER BY spine",
        )?;
        let rows = stmt.query_map([resource_id], |row| {
            Ok(EpubChapterSummary {
                spine: row.get(0)?,
                title: row.get(1)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_epub_chapter(
        &self,
        resource_id: &str,
        spine: i64,
    ) -> Result<Option<EpubChapter>> {
        let mut stmt = self.connection.prepare(
            "SELECT spine, title, href, html FROM epub_chapters
             WHERE resource_id = ?1 AND spine = ?2",
        )?;
        let chapter = stmt
            .query_row(params![resource_id, spine], |row| {
                Ok(EpubChapter {
                    spine: row.get(0)?,
                    title: row.get(1)?,
                    href: row.get(2)?,
                    html: row.get(3)?,
                })
            })
            .optional()?;
        Ok(chapter)
    }

    pub fn list_resources(&self) -> Result<Vec<Resource>> {
        let mut stmt = self.connection.prepare(
            "SELECT r.id, r.kind, r.title, r.abbreviation, r.language, r.source_format,
                    r.source_path, r.verse_count, r.entry_count, r.imported_at, r.metadata,
                    r.search_priority, COALESCE(b.cloud_synced, 0)
             FROM resources r
             LEFT JOIN pbb_books b ON b.resource_id = r.id
             ORDER BY r.search_priority DESC, CASE r.kind
                WHEN 'bible' THEN 0
                WHEN 'commentary' THEN 1
                WHEN 'dictionary' THEN 2
                WHEN 'reference' THEN 3
                WHEN 'map' THEN 4
                ELSE 5 END, r.title",
        )?;
        let rows = stmt.query_map([], row_to_resource)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_resource(&self, id: &str) -> Result<Option<Resource>> {
        let mut stmt = self.connection.prepare(
            "SELECT r.id, r.kind, r.title, r.abbreviation, r.language, r.source_format,
                    r.source_path, r.verse_count, r.entry_count, r.imported_at, r.metadata,
                    r.search_priority, COALESCE(b.cloud_synced, 0)
             FROM resources r
             LEFT JOIN pbb_books b ON b.resource_id = r.id
             WHERE r.id = ?1",
        )?;
        let resource = stmt.query_row([id], row_to_resource).optional()?;
        Ok(resource)
    }

    pub fn get_verses(&self, resource_id: &str, book: i64, chapter: i64) -> Result<Vec<Verse>> {
        let mut stmt = self.connection.prepare(
            "SELECT book, chapter, verse, html
             FROM verses
             WHERE resource_id = ?1 AND book = ?2 AND chapter = ?3
             ORDER BY verse",
        )?;
        let rows = stmt.query_map(params![resource_id, book, chapter], |row| {
            Ok(Verse {
                book: row.get(0)?,
                chapter: row.get(1)?,
                verse: row.get(2)?,
                html: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_book_verses(&self, resource_id: &str, book: i64) -> Result<Vec<Verse>> {
        let mut stmt = self.connection.prepare(
            "SELECT book, chapter, verse, html
             FROM verses
             WHERE resource_id = ?1 AND book = ?2
             ORDER BY chapter, verse",
        )?;
        let rows = stmt.query_map(params![resource_id, book], |row| {
            Ok(Verse {
                book: row.get(0)?,
                chapter: row.get(1)?,
                verse: row.get(2)?,
                html: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_commentaries(
        &self,
        resource_id: &str,
        book: i64,
        chapter: i64,
        verse: i64,
    ) -> Result<Vec<CommentaryEntry>> {
        let mut stmt = self.connection.prepare(
            r#"
            SELECT book, chapter_start, verse_start, chapter_end, verse_end, html
            FROM commentary
            WHERE resource_id = ?1 AND book = ?2
              AND (
                (?3 = 1 AND chapter_start = 0 AND chapter_end = 0)
                OR (
                  (chapter_start < ?3 OR (chapter_start = ?3 AND verse_start <= ?4))
                  AND (chapter_end > ?3 OR (chapter_end = ?3 AND verse_end >= ?4))
                )
              )
            ORDER BY chapter_start, verse_start
            "#,
        )?;
        let rows = stmt.query_map(params![resource_id, book, chapter, verse], |row| {
            Ok(CommentaryEntry {
                book: row.get(0)?,
                chapter_start: row.get(1)?,
                verse_start: row.get(2)?,
                chapter_end: row.get(3)?,
                verse_end: row.get(4)?,
                html: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn dictionary_topics(&self, resource_id: &str, limit: i64) -> Result<Vec<String>> {
        let mut stmt = self.connection.prepare(
            "SELECT topic FROM dictionary WHERE resource_id = ?1 ORDER BY topic LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![resource_id, limit], |row| row.get(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn lookup_dictionary(
        &self,
        resource_id: &str,
        topic: &str,
    ) -> Result<Option<DictionaryEntry>> {
        let candidates = strong_candidates(topic);
        for candidate in &candidates {
            let exact = self
                .connection
                .query_row(
                    "SELECT topic, html FROM dictionary
                     WHERE resource_id = ?1 AND lower(topic) = lower(?2) LIMIT 1",
                    params![resource_id, candidate],
                    |row| {
                        Ok(DictionaryEntry {
                            topic: row.get(0)?,
                            html: row.get(1)?,
                        })
                    },
                )
                .optional()?;
            if exact.is_some() {
                return Ok(exact);
            }
        }
        if candidates.len() > 1 {
            for candidate in &candidates {
                let any_dict = self
                    .connection
                    .query_row(
                        "SELECT topic, html FROM dictionary
                         WHERE lower(topic) = lower(?1) LIMIT 1",
                        params![candidate],
                        |row| {
                            Ok(DictionaryEntry {
                                topic: row.get(0)?,
                                html: row.get(1)?,
                            })
                        },
                    )
                    .optional()?;
                if any_dict.is_some() {
                    return Ok(any_dict);
                }
            }
        }
        let prefix = format!("{}%", escape_like(topic));
        let contains = format!("%{}%", escape_like(topic));
        let result = self
            .connection
            .query_row(
                "SELECT topic, html FROM dictionary
                 WHERE resource_id = ?1
                   AND (
                     lower(topic) LIKE lower(?2) ESCAPE '\\'
                     OR lower(html) LIKE lower(?3) ESCAPE '\\'
                   )
                 ORDER BY
                   CASE WHEN lower(topic) LIKE lower(?2) ESCAPE '\\' THEN 0 ELSE 1 END,
                   length(topic)
                 LIMIT 1",
                params![resource_id, prefix, contains],
                |row| {
                    Ok(DictionaryEntry {
                        topic: row.get(0)?,
                        html: row.get(1)?,
                    })
                },
            )
            .optional()?;
        Ok(result)
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let pattern = format!("%{}%", escape_like(query));
        let mut hits = Vec::new();
        // Keep room for every source type instead of letting the first query
        // consume the whole result window.
        let per_kind = (limit / 4).max(1);

        let mut stmt = self.connection.prepare(
            "SELECT v.resource_id, r.title, v.book, v.chapter, v.verse, v.html
             FROM verses v JOIN resources r ON r.id = v.resource_id
             WHERE v.html LIKE ?1 ESCAPE '\\'
             ORDER BY r.search_priority DESC, v.book, v.chapter, v.verse LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, per_kind as i64], |row| {
            let book: i64 = row.get(2)?;
            let chapter: i64 = row.get(3)?;
            let verse: i64 = row.get(4)?;
            let html: String = row.get(5)?;
            Ok(SearchHit {
                kind: "verse".to_string(),
                resource_id: row.get(0)?,
                resource_title: row.get(1)?,
                label: format!("{} {}:{}", book_name(book), chapter, verse),
                book,
                chapter,
                verse,
                html: snippet(&html, query, 220),
            })
        })?;
        hits.extend(rows.collect::<rusqlite::Result<Vec<_>>>()?);

        let mut stmt = self.connection.prepare(
            "SELECT c.resource_id, r.title, c.book, c.chapter_start, c.verse_start, c.html
             FROM commentary c JOIN resources r ON r.id = c.resource_id
             WHERE c.html LIKE ?1 ESCAPE '\\'
             ORDER BY r.search_priority DESC, c.book, c.chapter_start, c.verse_start LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, per_kind as i64], |row| {
            let book: i64 = row.get(2)?;
            let chapter: i64 = row.get(3)?;
            let verse: i64 = row.get(4)?;
            let html: String = row.get(5)?;
            Ok(SearchHit {
                kind: "commentary".to_string(),
                resource_id: row.get(0)?,
                resource_title: row.get(1)?,
                label: format!("{} {}:{}", book_name(book), chapter, verse),
                book,
                chapter,
                verse,
                html: snippet(&html, query, 220),
            })
        })?;
        hits.extend(rows.collect::<rusqlite::Result<Vec<_>>>()?);

        let mut stmt = self.connection.prepare(
            "SELECT d.resource_id, r.title, d.topic, d.html
             FROM dictionary d JOIN resources r ON r.id = d.resource_id
             WHERE d.topic LIKE ?1 ESCAPE '\\' OR d.html LIKE ?1 ESCAPE '\\'
             ORDER BY r.search_priority DESC, d.topic LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, per_kind as i64], |row| {
            let topic: String = row.get(2)?;
            let html: String = row.get(3)?;
            Ok(SearchHit {
                kind: "dictionary".to_string(),
                resource_id: row.get(0)?,
                resource_title: row.get(1)?,
                label: topic,
                book: 0,
                chapter: 0,
                verse: 0,
                html: snippet(&html, query, 220),
            })
        })?;
        hits.extend(rows.collect::<rusqlite::Result<Vec<_>>>()?);

        let mut stmt = self.connection.prepare(
            "SELECT e.resource_id, r.title, e.spine, e.title, e.html
             FROM epub_chapters e JOIN resources r ON r.id = e.resource_id
             WHERE e.html LIKE ?1 ESCAPE '\\' OR e.title LIKE ?1 ESCAPE '\\'
             ORDER BY r.search_priority DESC, e.spine LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, per_kind as i64], |row| {
            let spine: i64 = row.get(2)?;
            let chapter_title: String = row.get(3)?;
            let html: String = row.get(4)?;
            Ok(SearchHit {
                kind: "book".to_string(),
                resource_id: row.get(0)?,
                resource_title: row.get(1)?,
                label: chapter_title,
                book: 0,
                chapter: spine,
                verse: 0,
                html: snippet(&html, query, 220),
            })
        })?;
        hits.extend(rows.collect::<rusqlite::Result<Vec<_>>>()?);

        hits.truncate(limit);
        Ok(hits)
    }

    pub fn upsert_pbb_book(&mut self, book: &PbbBook) -> Result<()> {
        let custom = serde_json::to_string(&book.custom_attributes)?;
        self.connection.execute(
            r#"
            INSERT INTO pbb_books
                (resource_id, title, resource_type, language, author, copyright,
                 description, cover_path, custom_attributes, log_path, status,
                 error_count, warning_count, cloud_synced, hidden, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
            ON CONFLICT(resource_id) DO UPDATE SET
                title=excluded.title,
                resource_type=excluded.resource_type,
                language=excluded.language,
                author=excluded.author,
                copyright=excluded.copyright,
                description=excluded.description,
                cover_path=excluded.cover_path,
                custom_attributes=excluded.custom_attributes,
                log_path=excluded.log_path,
                status=excluded.status,
                error_count=excluded.error_count,
                warning_count=excluded.warning_count,
                hidden=excluded.hidden,
                updated_at=excluded.updated_at
            "#,
            params![
                book.resource_id,
                book.title,
                book.resource_type,
                book.language,
                book.author,
                book.copyright,
                book.description,
                book.cover_path,
                custom,
                book.log_path,
                book.status,
                book.error_count,
                book.warning_count,
                book.cloud_synced as i64,
                book.hidden as i64,
                book.created_at,
                book.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn replace_pbb_sources(
        &mut self,
        resource_id: &str,
        sources: &[PbbSourceRecord],
    ) -> Result<()> {
        let tx = self.connection.transaction()?;
        tx.execute("DELETE FROM pbb_sources WHERE resource_id = ?1", [resource_id])?;
        {
            let mut insert = tx.prepare(
                "INSERT INTO pbb_sources (resource_id, path, order_index, modified, size)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for source in sources {
                insert.execute(params![
                    resource_id,
                    source.path,
                    source.order_index,
                    source.modified,
                    source.size,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn pbb_sources(&self, resource_id: &str) -> Result<Vec<PbbSourceRecord>> {
        let mut stmt = self.connection.prepare(
            "SELECT path, order_index, modified, size FROM pbb_sources
             WHERE resource_id = ?1 ORDER BY order_index, path",
        )?;
        let rows = stmt.query_map([resource_id], |row| {
            Ok(PbbSourceRecord {
                path: row.get(0)?,
                order_index: row.get(1)?,
                modified: row.get(2)?,
                size: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn pbb_books(&self) -> Result<Vec<PbbBook>> {
        let mut books = {
            let mut stmt = self.connection.prepare(
                "SELECT resource_id, title, resource_type, language, author, copyright,
                        description, cover_path, custom_attributes, log_path, status,
                        error_count, warning_count, cloud_synced, hidden, created_at, updated_at
                 FROM pbb_books ORDER BY title COLLATE NOCASE",
            )?;
            let rows = stmt.query_map([], row_to_pbb_book)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for book in &mut books {
            book.sources = self.pbb_sources(&book.resource_id)?;
        }
        Ok(books)
    }

    pub fn pbb_book(&self, resource_id: &str) -> Result<Option<PbbBook>> {
        let mut book = self
            .connection
            .query_row(
                "SELECT resource_id, title, resource_type, language, author, copyright,
                        description, cover_path, custom_attributes, log_path, status,
                        error_count, warning_count, cloud_synced, hidden, created_at, updated_at
                 FROM pbb_books WHERE resource_id = ?1",
                [resource_id],
                row_to_pbb_book,
            )
            .optional()?;
        if let Some(value) = &mut book {
            value.sources = self.pbb_sources(resource_id)?;
        }
        Ok(book)
    }

    pub fn seed_word_study(&mut self, gz_path: &Path) -> Result<bool> {
        let version: Option<String> = self
            .connection
            .query_row(
                "SELECT value FROM word_study_meta WHERE key = 'version'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if version.as_deref() == Some("1") {
            return Ok(false);
        }
        if !gz_path.exists() {
            return Ok(false);
        }
        let temp = std::env::temp_dir().join(format!(
            "teoamoxtli-wordstudy-{}.sqlite",
            std::process::id()
        ));
        let _ = fs::remove_file(&temp);
        {
            let mut input = GzDecoder::new(fs::File::open(gz_path)?);
            let mut output = fs::File::create(&temp)?;
            copy_reader(&mut input, &mut output)?;
        }
        self.connection.execute(
            "ATTACH DATABASE ?1 AS wordstudy",
            params![temp.to_string_lossy().to_string()],
        )?;
        let result = (|| -> Result<()> {
            let tx = self.connection.transaction()?;
            tx.execute("DELETE FROM strong_entries", [])?;
            tx.execute(
                "INSERT OR REPLACE INTO strong_entries
                 SELECT id, language, lemma, transliteration, pronunciation,
                        definition, derivation, kjv, html, source
                 FROM wordstudy.strong_entries",
                [],
            )?;
            tx.execute("DELETE FROM word_occurrences", [])?;
            tx.execute(
                "INSERT INTO word_occurrences
                    (source, strong_number, book, chapter, verse, word_order, word,
                     lemma, transliteration, morphology)
                 SELECT source, strong_number, book, chapter, verse, word_order, word,
                        lemma, transliteration, morphology
                 FROM wordstudy.word_occurrences",
                [],
            )?;
            tx.execute(
                "INSERT OR REPLACE INTO word_study_meta(key, value) VALUES ('version', '1')",
                [],
            )?;
            tx.commit()?;
            Ok(())
        })();
        let _ = self.connection.execute("DETACH DATABASE wordstudy", []);
        let _ = fs::remove_file(&temp);
        result?;
        Ok(true)
    }

    pub fn seed_factory_interlinear(&mut self, gz_path: &Path) -> Result<bool> {
        let count: i64 = self.connection.query_row(
            "SELECT count(*) FROM interlinear_tokens", [], |row| row.get(0))?;
        if count > 0 || !gz_path.exists() { return Ok(false); }
        let temp = std::env::temp_dir().join(format!(
            "teoamoxtli-interlinear-factory-{}.sqlite", std::process::id()));
        let _ = fs::remove_file(&temp);
        {
            let mut input = GzDecoder::new(fs::File::open(gz_path)?);
            let mut output = fs::File::create(&temp)?;
            copy_reader(&mut input, &mut output)?;
        }
        self.connection.execute("ATTACH DATABASE ?1 AS factory", params![temp.to_string_lossy().to_string()])?;
        let result = (|| -> Result<()> {
            let tx = self.connection.transaction()?;
            tx.execute("INSERT OR IGNORE INTO resources SELECT * FROM factory.resources", [])?;
            tx.execute("INSERT OR IGNORE INTO verses SELECT * FROM factory.verses", [])?;
            tx.execute("INSERT OR IGNORE INTO dictionary SELECT * FROM factory.dictionary", [])?;
            tx.execute("INSERT OR REPLACE INTO strong_entries SELECT * FROM factory.strong_entries", [])?;
            tx.execute("INSERT INTO interlinear_tokens (id,resource_id,book,chapter,verse,word_order,surface_text,original_manuscript,transliteration,lemma,strong_number,morphology_code,spanish_gloss) SELECT id,resource_id,book,chapter,verse,word_order,surface_text,original_manuscript,transliteration,lemma,strong_number,morphology_code,spanish_gloss FROM factory.interlinear_tokens", [])?;
            tx.commit()?;
            Ok(())
        })();
        let _ = self.connection.execute("DETACH DATABASE factory", []);
        let _ = fs::remove_file(&temp);
        result?;
        Ok(true)
    }

    pub fn set_resource_priority(&self, resource_id: &str, priority: bool) -> Result<()> {
        self.connection.execute(
            "UPDATE resources SET search_priority = ?1 WHERE id = ?2",
            params![if priority { 1 } else { 0 }, resource_id],
        )?;
        Ok(())
    }

    pub fn update_resource_metadata(
        &mut self,
        resource_id: &str,
        metadata: &str,
    ) -> Result<()> {
        self.connection.execute(
            "UPDATE resources SET metadata = ?1 WHERE id = ?2",
            rusqlite::params![metadata, resource_id],
        )?;
        Ok(())
    }

    pub fn delete_resource(&mut self, resource_id: &str) -> Result<()> {
        let tx = self.connection.transaction()?;
        for table in [
            "pbb_sources",
            "pbb_books",
            "pbb_fts",
            "global_search_index",
            "epub_chapters",
            "verses",
            "commentary",
            "dictionary",
        ] {
            let sql = if table == "pbb_fts" {
                "DELETE FROM pbb_fts WHERE resource_id = ?1".to_string()
            } else {
                format!("DELETE FROM {table} WHERE resource_id = ?1")
            };
            tx.execute(&sql, [resource_id])?;
        }
        tx.execute("DELETE FROM resources WHERE id = ?1", [resource_id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn split_epub_chapter(
        &mut self, resource_id: &str, spine: i64, before_html: &str,
        after_html: &str, new_title: &str,
    ) -> Result<Vec<EpubChapterSummary>> {
        let tx = self.connection.transaction()?;
        tx.execute("UPDATE epub_chapters SET html=?1 WHERE resource_id=?2 AND spine=?3", params![before_html, resource_id, spine])?;
        tx.execute("UPDATE epub_chapters SET spine=spine+1 WHERE resource_id=?1 AND spine>?2 ORDER BY spine DESC", params![resource_id, spine])?;
        tx.execute("INSERT INTO epub_chapters(resource_id,spine,title,href,html) VALUES(?1,?2,?3,?4,?5)",
            params![resource_id, spine + 1, new_title, format!("pbb://{resource_id}/{}", spine + 1), after_html])?;
        tx.execute("UPDATE resources SET entry_count=(SELECT COUNT(*) FROM epub_chapters WHERE resource_id=?1) WHERE id=?1", [resource_id])?;
        tx.commit()?;
        self.epub_chapters(resource_id)
    }

    pub fn merge_epub_chapter_with_previous(&mut self, resource_id: &str, spine: i64) -> Result<Vec<EpubChapterSummary>> {
        if spine <= 0 { return self.epub_chapters(resource_id); }
        let tx = self.connection.transaction()?;
        let previous: String = tx.query_row("SELECT html FROM epub_chapters WHERE resource_id=?1 AND spine=?2", params![resource_id, spine - 1], |row| row.get(0))?;
        let current: (String, String) = tx.query_row("SELECT title,html FROM epub_chapters WHERE resource_id=?1 AND spine=?2", params![resource_id, spine], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let merged = format!("{}<h2 class=\"editorial-part-kicker\">{}</h2>{}", previous, current.0, current.1);
        tx.execute("UPDATE epub_chapters SET html=?1 WHERE resource_id=?2 AND spine=?3", params![merged, resource_id, spine - 1])?;
        tx.execute("DELETE FROM epub_chapters WHERE resource_id=?1 AND spine=?2", params![resource_id, spine])?;
        tx.execute("UPDATE epub_chapters SET spine=spine-1 WHERE resource_id=?1 AND spine>?2 ORDER BY spine ASC", params![resource_id, spine])?;
        tx.execute("UPDATE resources SET entry_count=(SELECT COUNT(*) FROM epub_chapters WHERE resource_id=?1) WHERE id=?1", [resource_id])?;
        tx.commit()?;
        self.epub_chapters(resource_id)
    }

    pub fn rename_epub_chapter(&mut self, resource_id: &str, spine: i64, new_title: &str) -> Result<()> {
        let tx = self.connection.transaction()?;
        let html: String = tx.query_row("SELECT html FROM epub_chapters WHERE resource_id=?1 AND spine=?2", params![resource_id, spine], |row| row.get(0))?;
        let heading = Regex::new(r"(?is)<h1[^>]*>.*?</h1>").unwrap();
        let updated = if heading.is_match(&html) {
            heading.replace(&html, format!("<h1>{}</h1>", new_title.replace('<', "&lt;").replace('>', "&gt;"))).to_string()
        } else {
            format!("<h1>{}</h1>{}", new_title.replace('<', "&lt;").replace('>', "&gt;"), html)
        };
        tx.execute("UPDATE epub_chapters SET title=?1, html=?2 WHERE resource_id=?3 AND spine=?4", params![new_title, updated, resource_id, spine])?;
        tx.commit()?;
        Ok(())
    }

    pub fn replace_pbb_fts(&mut self, resource_id: &str, chapters: &[EpubChapter]) -> Result<()> {
        let tx = self.connection.transaction()?;
        tx.execute("DELETE FROM pbb_fts WHERE resource_id = ?1", [resource_id])?;
        {
            let mut insert =
                tx.prepare("INSERT INTO pbb_fts (resource_id, chapter, title, body) VALUES (?1, ?2, ?3, ?4)")?;
            for chapter in chapters {
                insert.execute(params![
                    resource_id,
                    chapter.spine,
                    chapter.title,
                    strip_tags(&chapter.html),
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn pbb_search_fts(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let mut stmt = self.connection.prepare(
            "SELECT f.resource_id, r.title, f.chapter, f.title,
                    snippet(pbb_fts, 3, '…', '…', '…', 24)
             FROM pbb_fts f JOIN resources r ON r.id = f.resource_id
             WHERE pbb_fts MATCH ?1 ORDER BY rank LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![query, limit as i64], |row| {
            Ok(SearchHit {
                kind: "book".to_string(),
                resource_id: row.get(0)?,
                resource_title: row.get(1)?,
                label: row.get(3)?,
                book: 0,
                chapter: row.get(2)?,
                verse: 0,
                html: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn set_pbb_cloud_synced(&mut self, resource_id: &str, synced: bool) -> Result<()> {
        self.connection.execute(
            "UPDATE pbb_books SET cloud_synced = ?2, updated_at = ?3 WHERE resource_id = ?1",
            params![resource_id, synced as i64, now_epoch()],
        )?;
        Ok(())
    }

    pub fn set_pbb_hidden(&mut self, resource_id: &str, hidden: bool) -> Result<()> {
        self.connection.execute(
            "UPDATE pbb_books SET hidden = ?2, updated_at = ?3 WHERE resource_id = ?1",
            params![resource_id, hidden as i64, now_epoch()],
        )?;
        Ok(())
    }

    pub fn clear(&mut self) -> Result<()> {
        self.connection.execute_batch(
            "DELETE FROM pbb_sources; DELETE FROM pbb_books; DELETE FROM pbb_fts;
             DELETE FROM verses; DELETE FROM commentary; DELETE FROM dictionary;
             DELETE FROM epub_chapters; DELETE FROM resources;",
        )?;
        Ok(())
    }
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<()> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !names.iter().any(|name| name == column) {
        connection.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )?;
    }
    Ok(())
}

fn row_to_resource(row: &Row<'_>) -> rusqlite::Result<Resource> {
    let metadata: String = row.get(10)?;
    Ok(Resource {
        id: row.get(0)?,
        kind: ResourceKind::from_db(&row.get::<_, String>(1)?),
        title: row.get(2)?,
        abbreviation: row.get(3)?,
        language: row.get(4)?,
        source_format: row.get(5)?,
        source_path: row.get(6)?,
        verse_count: row.get(7)?,
        entry_count: row.get(8)?,
        imported_at: row.get(9)?,
        metadata: serde_json::from_str(&metadata).unwrap_or(serde_json::Value::Null),
        search_priority: row.get(11)?,
        cloud_synced: row.get::<_, i64>(12)? != 0,
    })
}

fn row_to_pbb_book(row: &Row<'_>) -> rusqlite::Result<PbbBook> {
    let custom: String = row.get(8)?;
    Ok(PbbBook {
        resource_id: row.get(0)?,
        title: row.get(1)?,
        resource_type: row.get(2)?,
        language: row.get(3)?,
        author: row.get(4)?,
        copyright: row.get(5)?,
        description: row.get(6)?,
        cover_path: row.get(7)?,
        custom_attributes: serde_json::from_str::<Vec<PbbCustomAttribute>>(&custom)
            .unwrap_or_default(),
        sources: Vec::new(),
        log_path: row.get(9)?,
        status: row.get(10)?,
        error_count: row.get(11)?,
        warning_count: row.get(12)?,
        cloud_synced: row.get::<_, i64>(13)? != 0,
        hidden: row.get::<_, i64>(14)? != 0,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn snippet(html: &str, query: &str, max_chars: usize) -> String {
    let plain = strip_tags(html);
    let lower = plain.to_lowercase();
    let needle = query.to_lowercase();
    let Some(position) = lower.find(&needle) else {
        return truncate_chars(&plain, max_chars);
    };
    let start = position.saturating_sub(60);
    let slice = plain.chars().skip(start).take(max_chars).collect::<String>();
    format!("…{}…", slice.trim())
}

fn strip_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                result.push(' ');
            }
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut result = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        result.push('…');
    }
    result
}

pub fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn strong_candidates(topic: &str) -> Vec<String> {
    let trimmed = topic.trim();
    let mut candidates = vec![trimmed.to_string()];
    let base = trimmed.split('_').next().unwrap_or(trimmed).trim();
    if base != trimmed && !base.is_empty() {
        candidates.push(base.to_string());
    }
    let mut chars = base.chars();
    if let Some(prefix) = chars.next() {
        let upper_prefix = prefix.to_ascii_uppercase();
        if upper_prefix == 'G' || upper_prefix == 'H' {
            let rest = chars.as_str();
            let digits_end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            let digits = &rest[..digits_end];
            let suffix = &rest[digits_end..];
            if !digits.is_empty() {
                if let Ok(num) = digits.parse::<u32>() {
                    let padded = format!("{upper_prefix}{num:04}");
                    let unpadded = format!("{upper_prefix}{num}");
                    if !suffix.is_empty() {
                        let padded_suffix = format!("{padded}{suffix}");
                        let unpadded_suffix = format!("{unpadded}{suffix}");
                        if !candidates.contains(&padded_suffix) {
                            candidates.push(padded_suffix);
                        }
                        if !candidates.contains(&unpadded_suffix) {
                            candidates.push(unpadded_suffix);
                        }
                    }
                    if !candidates.contains(&padded) {
                        candidates.push(padded);
                    }
                    if !candidates.contains(&unpadded) {
                        candidates.push(unpadded);
                    }
                }
            }
        }
    }
    candidates
}
