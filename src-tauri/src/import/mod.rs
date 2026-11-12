use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde_json::json;
use walkdir::WalkDir;

use crate::db::{now_epoch, Catalog};
use crate::gbf::normalize_html;
use crate::model::{
    CommentaryEntry, DictionaryEntry, EpubChapter, ImportReport, Resource, ResourceKind, Verse,
};

pub mod docx;
pub mod epub;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "bbli", "bblx", "cmti", "dcti", "lexi", "refi", "mapx", "mybible", "epub", "azw3", "mobi", "docx",
];

pub fn scan_folder(path: &Path) -> Vec<PathBuf> {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !matches!(
                name.as_ref(),
                ".git" | "node_modules" | "target" | ".tools" | "dist"
            )
        })
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            name.ends_with(".mybible")
                || name
                    .rsplit_once('.')
                    .map(|(_, extension)| SUPPORTED_EXTENSIONS.contains(&extension))
                    .unwrap_or(false)
        })
        .map(|entry| entry.into_path())
        .collect()
}

pub fn import_path(catalog: &mut Catalog, path: &Path) -> Result<ImportReport> {
    if !path.is_file() {
        return Err(anyhow!("no existe el archivo {}", path.display()));
    }
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if extension == "epub" {
        return epub::import_epub(catalog, path);
    }
    if matches!(extension.as_str(), "azw3" | "mobi") {
        let temp_dir = std::env::temp_dir().join("teoamoxtli-ebook-import");
        let converted = crate::pbb::convert_ebook_to_epub(path, &temp_dir, 0, &extension)?;
        let parsed = epub::read_epub_package(&converted)?;
        let _ = std::fs::remove_file(&converted);
        let file_name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| format!("libro.{extension}"));
        let abbreviation = parsed.title.chars().take(28).collect::<String>();
        let mut resource = Resource {
            id: format!(
                "{extension}:{}",
                file_name.to_ascii_lowercase().replace(' ', "_")
            ),
            kind: ResourceKind::Book,
            title: parsed.title.clone(),
            abbreviation,
            language: parsed.language.clone().unwrap_or_default(),
            source_format: extension.clone(),
            source_path: path.to_string_lossy().to_string(),
            verse_count: 0,
            entry_count: parsed.chapters.len() as i64,
            imported_at: now_epoch(),
            search_priority: 0,
            cloud_synced: false,
            metadata: json!({
                "title": parsed.title,
                "creator": parsed.creator,
                "language": parsed.language,
                "identifier": parsed.identifier,
                "epubVersion": parsed.version,
                "chapterCount": parsed.chapters.len(),
            }),
        };
        catalog.upsert_resource(&resource)?;
        catalog.replace_epub_chapters(&resource.id, &parsed.chapters)?;
        resource.entry_count = parsed.chapters.len() as i64;
        catalog.upsert_resource(&resource)?;
        return Ok(ImportReport {
            resource,
            warnings: parsed.warnings,
        });
    }
    if extension == "docx" {
        let doc = docx::read_docx(path)?;
        let file_name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "libro.docx".to_string());
        let title = if doc.title.trim().is_empty() {
            clean_stem(&file_name)
        } else {
            doc.title.clone()
        };
        let abbreviation = title.chars().take(28).collect::<String>();
        let resource_id = format!(
            "docx:{}",
            file_name.to_ascii_lowercase().replace(' ', "_")
        );
        let chapters: Vec<EpubChapter> = doc
            .articles
            .iter()
            .enumerate()
            .map(|(idx, article)| EpubChapter {
                spine: idx as i64,
                title: article.title.clone(),
                href: format!("docx://{resource_id}/{idx}"),
                html: article.html.clone(),
            })
            .collect();
        let mut resource = Resource {
            id: resource_id.clone(),
            kind: ResourceKind::Book,
            title: title.clone(),
            abbreviation,
            language: "es".to_string(),
            source_format: "docx".to_string(),
            source_path: path.to_string_lossy().to_string(),
            verse_count: 0,
            entry_count: chapters.len() as i64,
            imported_at: now_epoch(),
            search_priority: 0,
            cloud_synced: false,
            metadata: json!({
                "title": title,
                "creator": doc.author,
                "description": doc.description,
                "chapterCount": chapters.len(),
            }),
        };
        catalog.upsert_resource(&resource)?;
        catalog.replace_epub_chapters(&resource.id, &chapters)?;
        catalog.replace_pbb_fts(&resource.id, &chapters)?;
        let warnings = doc
            .issues
            .into_iter()
            .map(|i| format!("[{}] {}: {}", i.severity, i.code, i.message))
            .collect();
        return Ok(ImportReport { resource, warnings });
    }

    ensure_sqlite(path)?;
    let source_format = detect_source_format(path);
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("no se pudo abrir el módulo {}", path.display()))?;
    let tables = table_names(&connection)?;
    let kind = detect_kind(&tables, &extension)
        .ok_or_else(|| anyhow!("no se reconoce el tipo de módulo {}", path.display()))?;
    let details = read_details(&connection)?;

    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "modulo".to_string());
    let title = field(&details, &["Title", "Description"])
        .unwrap_or_else(|| clean_stem(&file_name));
    let abbreviation = field(&details, &["Abbreviation", "Abbrev"]).unwrap_or_else(|| title.clone());
    let language = field(&details, &["Language", "Lang"]).unwrap_or_default();
    let id = format!(
        "{}:{}",
        source_format,
        file_name.to_ascii_lowercase().replace(' ', "_")
    );
    let metadata = json!({
        "title": title,
        "abbreviation": abbreviation,
        "language": language,
        "version": field(&details, &["Version"]),
        "versionDate": field(&details, &["VersionDate", "PublishDate"]),
        "publisher": field(&details, &["Publisher"]),
        "author": field(&details, &["Author"]),
        "description": field(&details, &["Description"]),
        "tables": tables,
    });

    let mut resource = Resource {
        id,
        kind,
        title,
        abbreviation,
        language,
        source_format: source_format.to_string(),
        source_path: path.to_string_lossy().to_string(),
        verse_count: 0,
        entry_count: 0,
        imported_at: now_epoch(),
        search_priority: 0,
        cloud_synced: false,
        metadata,
    };
    catalog.upsert_resource(&resource)?;

    let mut warnings = Vec::new();
    match kind {
        ResourceKind::Bible => {
            if extension == "bblx" {
                warnings.push(
                    "Los módulos .bblx usan RTF; esta primera versión admite .bbli (HTML). \
                     Convierte el módulo o expórtalo como .bbli."
                        .to_string(),
                );
            } else {
                let verses = read_bible(&connection, source_format)?;
                if verses.is_empty() {
                    warnings.push("La tabla Bible está vacía.".to_string());
                }
                resource.verse_count = verses.len() as i64;
                catalog.replace_verses(&resource.id, &verses)?;
                catalog.upsert_resource(&resource)?;
            }
        }
        ResourceKind::Commentary => {
            let entries = read_commentaries(&connection, source_format, &mut warnings)?;
            if entries.is_empty() {
                warnings.push("No se encontraron entradas de comentario.".to_string());
            }
            resource.entry_count = entries.len() as i64;
            catalog.replace_commentaries(&resource.id, &entries)?;
            catalog.upsert_resource(&resource)?;
        }
        ResourceKind::Dictionary => {
            let entries = read_dictionary(&connection, source_format, &mut warnings)?;
            if entries.is_empty() {
                warnings.push("No se encontraron entradas de diccionario.".to_string());
            }
            resource.entry_count = entries.len() as i64;
            catalog.replace_dictionary(&resource.id, &entries)?;
            catalog.upsert_resource(&resource)?;
        }
        ResourceKind::Reference => {
            resource.entry_count = count_table(&connection, "Reference").unwrap_or(0);
            catalog.upsert_resource(&resource)?;
            warnings.push(
                "Las referencias cruzadas se catalogan ahora; su visor llegará en una fase posterior."
                    .to_string(),
            );
        }
        ResourceKind::Map => {
            resource.entry_count = count_table(&connection, "Graphics").unwrap_or(0);
            catalog.upsert_resource(&resource)?;
            warnings.push(
                "Los mapas se catalogan ahora; la galería de imágenes llegará en una fase posterior."
                    .to_string(),
            );
        }
        ResourceKind::Book => {
            resource.entry_count = count_table(&connection, "Book").unwrap_or(0);
            catalog.upsert_resource(&resource)?;
            warnings.push("Los libros de MySword se incorporarán en una fase posterior.".to_string());
        }
    }

    Ok(ImportReport { resource, warnings })
}

fn ensure_sqlite(path: &Path) -> Result<()> {
    let header = std::fs::read(path)
        .with_context(|| format!("no se pudo leer {}", path.display()))?
        .into_iter()
        .take(16)
        .collect::<Vec<_>>();
    if header != b"SQLite format 3\0" {
        return Err(anyhow!(
            "{} no es una base SQLite de e-Sword/MySword",
            path.display()
        ));
    }
    Ok(())
}

fn detect_source_format(path: &Path) -> &'static str {
    let name = path.file_name().unwrap_or_default().to_string_lossy().to_ascii_lowercase();
    if name.ends_with(".mybible") {
        "mysword"
    } else {
        "esword"
    }
}

fn detect_kind(tables: &[String], extension: &str) -> Option<ResourceKind> {
    if has_table(tables, "Bible") {
        return Some(ResourceKind::Bible);
    }
    if has_table(tables, "VerseCommentary")
        || has_table(tables, "Commentary")
        || has_table(tables, "BookCommentary")
    {
        return Some(ResourceKind::Commentary);
    }
    if has_table(tables, "Dictionary") || has_table(tables, "Lexicon") {
        return Some(ResourceKind::Dictionary);
    }
    if has_table(tables, "Reference") {
        return Some(ResourceKind::Reference);
    }
    if has_table(tables, "Graphics") {
        return Some(ResourceKind::Map);
    }
    if has_table(tables, "Book") {
        return Some(ResourceKind::Book);
    }
    match extension {
        "bbli" | "bblx" => Some(ResourceKind::Bible),
        "cmti" => Some(ResourceKind::Commentary),
        "dcti" | "lexi" => Some(ResourceKind::Dictionary),
        "refi" => Some(ResourceKind::Reference),
        "mapx" => Some(ResourceKind::Map),
        _ => None,
    }
}

fn table_names(connection: &Connection) -> Result<Vec<String>> {
    let mut stmt = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn table_columns(connection: &Connection, table: &str) -> Result<Vec<String>> {
    let mut stmt = connection.prepare(&format!("PRAGMA table_info({})", quote_ident(table)))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn read_details(connection: &Connection) -> Result<HashMap<String, String>> {
    let mut result = HashMap::new();
    let mut stmt = connection.prepare("SELECT * FROM Details LIMIT 1")?;
    let columns = stmt
        .column_names()
        .into_iter()
        .map(|name| name.to_string())
        .collect::<Vec<_>>();
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        for (index, column) in columns.iter().enumerate() {
            let value = match row.get_ref(index)? {
                ValueRef::Text(bytes) => String::from_utf8_lossy(bytes).to_string(),
                ValueRef::Integer(value) => value.to_string(),
                ValueRef::Real(value) => value.to_string(),
                _ => continue,
            };
            if !value.trim().is_empty() {
                result.insert(column.clone(), value);
            }
        }
    }
    Ok(result)
}

fn field(details: &HashMap<String, String>, names: &[&str]) -> Option<String> {
    for name in names {
        if let Some(value) = details
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.trim())
            .filter(|value| !value.is_empty())
        {
            return Some(value.to_string());
        }
    }
    None
}

fn clean_stem(file_name: &str) -> String {
    file_name
        .trim_end_matches(".mybible")
        .trim_end_matches(".bbli")
        .trim_end_matches(".bblx")
        .trim_end_matches(".cmti")
        .trim_end_matches(".dcti")
        .trim_end_matches(".refi")
        .trim_end_matches(".mapx")
        .to_string()
}

fn quote_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn read_bible(connection: &Connection, source_format: &str) -> Result<Vec<Verse>> {
    let mut stmt = connection.prepare(
        "SELECT Book, Chapter, Verse, Scripture FROM Bible ORDER BY Book, Chapter, Verse",
    )?;
    let rows = stmt.query_map([], |row| {
        let html: Option<String> = row.get(3)?;
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            html,
        ))
    })?;
    let mut verses = BTreeMap::new();
    for row in rows {
        let (book, chapter, verse, html) = row?;
        if let Some(html) = html {
            verses.insert(
                (book, chapter, verse),
                Verse {
                    book,
                    chapter,
                    verse,
                    html: normalize_html(&html, source_format),
                },
            );
        }
    }
    Ok(verses.into_values().collect())
}

fn read_commentaries(
    connection: &Connection,
    source_format: &str,
    warnings: &mut Vec<String>,
) -> Result<Vec<CommentaryEntry>> {
    let tables = table_names(connection)?;
    let mut entries = Vec::new();

    if has_table(&tables, "VerseCommentary") {
        entries.extend(read_verse_commentary(connection, source_format)?);
    } else if has_table(&tables, "Commentary") {
        entries.extend(read_generic_commentary(connection, source_format)?);
    } else {
        warnings.push("No hay tabla VerseCommentary ni Commentary.".to_string());
    }

    if has_table(&tables, "BookCommentary") {
        entries.extend(read_book_commentary(connection, source_format)?);
    }
    if has_table(&tables, "ChapterCommentary") {
        entries.extend(read_chapter_commentary(connection, source_format)?);
    }
    Ok(entries)
}

fn read_verse_commentary(
    connection: &Connection,
    source_format: &str,
) -> Result<Vec<CommentaryEntry>> {
    let columns = table_columns(connection, "VerseCommentary")?;
    let Some(text) = find_column(&columns, &["Comments", "Commentary", "Notes", "Text"]) else {
        return Ok(Vec::new());
    };
    let Some(book) = find_column(&columns, &["Book"]) else {
        return Ok(Vec::new());
    };
    let chapter_start = find_column(&columns, &["ChapterBegin", "Chapter", "ChapterStart"]).unwrap_or_else(|| "1".to_string());
    let verse_start = find_column(&columns, &["VerseBegin", "Verse", "VerseStart"]).unwrap_or_else(|| "1".to_string());
    let chapter_end = find_column(&columns, &["ChapterEnd"]).unwrap_or_else(|| chapter_start.clone());
    let verse_end = find_column(&columns, &["VerseEnd"]).unwrap_or_else(|| verse_start.clone());
    let sql = format!(
        "SELECT {book}, {chapter_start}, {verse_start}, {chapter_end}, {verse_end}, {text} FROM VerseCommentary"
    );
    let mut stmt = connection.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;
    let mut entries = Vec::new();
    for row in rows {
        let (book, chapter_start, verse_start, chapter_end, verse_end, html) = row?;
        if let Some(html) = html {
            entries.push(CommentaryEntry {
                book,
                chapter_start,
                verse_start,
                chapter_end,
                verse_end,
                html: normalize_html(&html, source_format),
            });
        }
    }
    Ok(entries)
}

fn read_generic_commentary(
    connection: &Connection,
    source_format: &str,
) -> Result<Vec<CommentaryEntry>> {
    let columns = table_columns(connection, "Commentary")?;
    let Some(text) = find_column(&columns, &["Data", "Notes", "Comments", "Commentary", "Text"]) else {
        return Ok(Vec::new());
    };
    let Some(book) = find_column(&columns, &["Book"]) else {
        return Ok(Vec::new());
    };
    let chapter_start = find_column(&columns, &["ChapterBegin", "Chapter", "ChapterStart"]).unwrap_or_else(|| "1".to_string());
    let verse_start = find_column(&columns, &["FromVerse", "VerseBegin", "Verse", "VerseStart"]).unwrap_or_else(|| "1".to_string());
    let chapter_end = find_column(&columns, &["ChapterEnd"]).unwrap_or_else(|| chapter_start.clone());
    let verse_end = find_column(&columns, &["ToVerse", "VerseEnd"]).unwrap_or_else(|| verse_start.clone());
    let sql = format!(
        "SELECT {book}, {chapter_start}, {verse_start}, {chapter_end}, {verse_end}, {text} FROM Commentary"
    );
    let mut stmt = connection.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, Option<String>>(5)?,
        ))
    })?;
    let mut entries = Vec::new();
    for row in rows {
        let (book, chapter_start, verse_start, chapter_end, verse_end, html) = row?;
        if let Some(html) = html {
            entries.push(CommentaryEntry {
                book,
                chapter_start,
                verse_start,
                chapter_end,
                verse_end,
                html: normalize_html(&html, source_format),
            });
        }
    }
    Ok(entries)
}

fn read_book_commentary(
    connection: &Connection,
    source_format: &str,
) -> Result<Vec<CommentaryEntry>> {
    let mut stmt = connection.prepare("SELECT Book, Comments FROM BookCommentary")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
    })?;
    let mut entries = Vec::new();
    for row in rows {
        let (book, html) = row?;
        if let Some(html) = html {
            entries.push(CommentaryEntry {
                book,
                chapter_start: 0,
                verse_start: 0,
                chapter_end: 0,
                verse_end: 0,
                html: normalize_html(&html, source_format),
            });
        }
    }
    Ok(entries)
}

fn read_chapter_commentary(
    connection: &Connection,
    source_format: &str,
) -> Result<Vec<CommentaryEntry>> {
    let mut stmt = connection.prepare("SELECT Book, Chapter, Comments FROM ChapterCommentary")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut entries = Vec::new();
    for row in rows {
        let (book, chapter, html) = row?;
        if let Some(html) = html {
            entries.push(CommentaryEntry {
                book,
                chapter_start: chapter,
                verse_start: 0,
                chapter_end: chapter,
                verse_end: 999,
                html: normalize_html(&html, source_format),
            });
        }
    }
    Ok(entries)
}

fn read_dictionary(
    connection: &Connection,
    source_format: &str,
    warnings: &mut Vec<String>,
) -> Result<Vec<DictionaryEntry>> {
    let tables = table_names(connection)?;
    let table = if has_table(&tables, "Dictionary") {
        "Dictionary"
    } else if has_table(&tables, "Lexicon") {
        "Lexicon"
    } else {
        warnings.push("No hay tabla Dictionary ni Lexicon.".to_string());
        return Ok(Vec::new());
    };
    let columns = table_columns(connection, table)?;
    let Some(topic) = find_column(&columns, &["Topic", "Word", "Term", "Name"]) else {
        warnings.push(format!("La tabla {table} no tiene una columna de tema."));
        return Ok(Vec::new());
    };
    let Some(definition) = find_column(
        &columns,
        &["Data", "Definition", "Notes", "Comments", "Text", "Html"],
    ) else {
        warnings.push(format!("La tabla {table} no tiene una columna de definición."));
        return Ok(Vec::new());
    };
    let sql = format!("SELECT {topic}, {definition} FROM {table}");
    let mut stmt = connection.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<String>>(1)?,
        ))
    })?;
    let mut entries = Vec::new();
    for row in rows {
        let (topic, html) = row?;
        if let (Some(topic), Some(html)) = (topic, html) {
            if !topic.trim().is_empty() {
                entries.push(DictionaryEntry {
                    topic,
                    html: normalize_html(&html, source_format),
                });
            }
        }
    }
    Ok(entries)
}

fn has_table(tables: &[String], name: &str) -> bool {
    tables.iter().any(|table| table.eq_ignore_ascii_case(name))
}

fn find_column(columns: &[String], candidates: &[&str]) -> Option<String> {
    for candidate in candidates {
        if let Some(column) = columns
            .iter()
            .find(|column| column.eq_ignore_ascii_case(candidate))
        {
            return Some(quote_ident(column));
        }
    }
    None
}

fn count_table(connection: &Connection, table: &str) -> Result<i64> {
    connection
        .query_row(&format!("SELECT COUNT(*) FROM {}", quote_ident(table)), [], |row| {
            row.get(0)
        })
        .map_err(Into::into)
}
