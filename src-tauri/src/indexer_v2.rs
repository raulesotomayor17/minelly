use anyhow::Result;
use rusqlite::{params, Connection};
use rust_stemmers::{Algorithm, Stemmer};
use serde_json::Value;

use crate::books::{all_books, book_number_from_osis, osis_code};
use crate::indexer::strip_html;
use crate::model::{PassageRangeHit, UnifiedSearchResult};

pub fn verse_code(book: i64, chapter: i64, verse: i64) -> i64 {
    book * 1_000_000 + chapter * 1_000 + verse
}

fn json_text(value: &Value, output: &mut String) {
    match value {
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                output.push_str(text);
                output.push(' ');
            }
            for (key, child) in map {
                if key == "attrs" {
                    continue;
                }
                json_text(child, output);
            }
        }
        Value::Array(items) => {
            for item in items {
                json_text(item, output);
            }
        }
        _ => {}
    }
}

pub fn plain_json_text(raw: &str) -> String {
    let mut output = String::new();
    if let Ok(value) = serde_json::from_str::<Value>(raw) {
        json_text(&value, &mut output);
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn note_tags(conn: &Connection, note_id: &str) -> String {
    conn.query_row(
        "SELECT COALESCE(GROUP_CONCAT(t.name, ' '), '') FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?1",
        [note_id],
        |row| row.get(0),
    )
    .unwrap_or_default()
}

pub fn sync_note_fts(conn: &Connection, note_id: &str) -> Result<()> {
    conn.execute("DELETE FROM notes_fts WHERE note_id = ?1", [note_id])?;
    let row = conn
        .query_row(
            "SELECT notebook_id, title, content_json FROM notes WHERE id = ?1",
            [note_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .ok();
    if let Some((notebook, title, content)) = row {
        let body = plain_json_text(&content);
        let tags = note_tags(conn, note_id);
        conn.execute(
            "INSERT INTO notes_fts(note_id, notebook_id, title, plain_body, tags_text)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![note_id, notebook, title, body, tags],
        )?;
    }
    Ok(())
}

pub fn sync_sermon_fts(conn: &Connection, sermon_id: &str) -> Result<()> {
    conn.execute("DELETE FROM sermons_fts WHERE sermon_id = ?1", [sermon_id])?;
    let row = conn
        .query_row(
            "SELECT title, series, speaker, passages, topics, content_json, questions_json
             FROM sermons WHERE id = ?1",
            [sermon_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .ok();
    if let Some((title, series, speaker, passages, topics, content, questions)) = row {
        let mut body = plain_json_text(&content);
        body.push(' ');
        body.push_str(&plain_json_text(&questions));
        conn.execute(
            "INSERT INTO sermons_fts(sermon_id, title, series, speaker, passages_text, topics_text, plain_body)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![sermon_id, title, series, speaker, passages, topics, body.trim()],
        )?;
    }
    Ok(())
}

pub fn rebuild_aux_indexes(conn: &Connection) -> Result<()> {
    // notes_fts: reconstrucción idempotente solo si está vacío.
    let notes_empty: i64 =
        conn.query_row("SELECT count(*) FROM notes_fts", [], |row| row.get(0))?;
    if notes_empty == 0 {
        let ids = {
            let mut stmt = conn.prepare("SELECT id FROM notes")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for id in ids {
            sync_note_fts(conn, &id)?;
        }
    }
    let sermons_empty: i64 =
        conn.query_row("SELECT count(*) FROM sermons_fts", [], |row| row.get(0))?;
    if sermons_empty == 0 {
        let ids = {
            let mut stmt = conn.prepare("SELECT id FROM sermons")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for id in ids {
            sync_sermon_fts(conn, &id)?;
        }
    }
    rebuild_passage_ranges(conn)?;
    Ok(())
}

pub fn rebuild_passage_ranges(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM passage_range_links", [])?;
    conn.execute("DELETE FROM passage_ranges_rtree", [])?;

    let mut commentary = conn.prepare(
        "SELECT rowid, resource_id, book, chapter_start, verse_start, chapter_end, verse_end, html
         FROM commentary",
    )?;
    let rows = commentary.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, String>(7)?,
        ))
    })?;
    for row in rows {
        let (rowid, resource, book, ch1, v1, ch2, v2, html) = row?;
        let start_code = verse_code(book, ch1, v1);
        let end_code = verse_code(book, ch2, v2.max(v1));
        // Algunos comentarios importados traen chapter_end < chapter_start.
        // RTree exige start <= end; normalizamos sin perder el texto original.
        let (start, end) = if start_code <= end_code {
            (start_code, end_code)
        } else {
            (end_code, start_code)
        };
        let label = format!("{} {}:{}–{}:{}", osis_code(book), ch1, v1, ch2, v2);
        let snippet = strip_html(&html).chars().take(260).collect::<String>();
        conn.execute(
            "INSERT INTO passage_range_links(source_type,resource_id,sub_id,reference_display,snippet)
             VALUES ('commentary',?1,?2,?3,?4)",
            params![resource, rowid.to_string(), label, snippet],
        )?;
        let id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO passage_ranges_rtree(id,start_verse_code,end_verse_code) VALUES (?1,?2,?3)",
            params![id, start, end],
        )?;
    }

    // Notas ancladas a referencias bíblicas.
    let mut notes = conn.prepare(
        "SELECT a.target_id, a.anchor_uri, a.exact_text, n.title, n.content_json
         FROM anchors a JOIN notes n ON n.id = a.target_id
         WHERE a.target_type = 'note' AND a.anchor_uri LIKE 'bible:%'",
    )?;
    let rows = notes.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    for row in rows {
        let (note_id, anchor, exact, title, content) = row?;
        let parts = anchor.split(':').collect::<Vec<_>>();
        if parts.len() < 4 {
            continue;
        }
        let book = book_number_from_osis(parts[1]).unwrap_or(0);
        let chapter = parts[2].parse::<i64>().unwrap_or(0);
        let verse = parts[3].parse::<i64>().unwrap_or(0);
        if book == 0 || chapter == 0 || verse == 0 {
            continue;
        }
        let code = verse_code(book, chapter, verse);
        let body = if exact.trim().is_empty() {
            plain_json_text(&content)
        } else {
            exact
        };
        conn.execute(
            "INSERT INTO passage_range_links(source_type,resource_id,sub_id,reference_display,snippet)
             VALUES ('note',?1,?2,?3,?4)",
            params![note_id, note_id, title, body.chars().take(260).collect::<String>()],
        )?;
        let id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO passage_ranges_rtree(id,start_verse_code,end_verse_code) VALUES (?1,?2,?3)",
            params![id, code, code],
        )?;
    }
    // Sermones: referencias declaradas en el campo passages del sermón.
    let mut sermons = conn.prepare("SELECT id, title, passages FROM sermons")?;
    let rows = sermons.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    for row in rows {
        let (sermon_id, title, passages) = row?;
        let values: Vec<String> = serde_json::from_str(&passages).unwrap_or_default();
        for reference in values {
            if let Some((book, chapter, verse)) = parse_simple_reference(&reference) {
                let code = verse_code(book, chapter, verse);
                conn.execute(
                    "INSERT INTO passage_range_links(source_type,resource_id,sub_id,reference_display,snippet)
                     VALUES ('sermon',?1,?2,?3,?4)",
                    params![sermon_id, sermon_id, reference, title],
                )?;
                let id = conn.last_insert_rowid();
                conn.execute(
                    "INSERT INTO passage_ranges_rtree(id,start_verse_code,end_verse_code) VALUES (?1,?2,?3)",
                    params![id, code, code],
                )?;
            }
        }
    }

    Ok(())
}

pub fn passage_range_search(
    conn: &Connection,
    book: i64,
    chapter: i64,
    verse_start: i64,
    verse_end: Option<i64>,
) -> Result<Vec<PassageRangeHit>> {
    let start = verse_code(book, chapter, verse_start);
    let end = verse_code(book, chapter, verse_end.unwrap_or(verse_start));
    let mut stmt = conn.prepare(
        "SELECT l.id,l.source_type,l.resource_id,l.sub_id,l.reference_display,l.snippet,
                r.start_verse_code,r.end_verse_code
         FROM passage_ranges_rtree r JOIN passage_range_links l ON l.id = r.id
         WHERE r.start_verse_code <= ?2 AND r.end_verse_code >= ?1
         ORDER BY (r.end_verse_code - r.start_verse_code) ASC",
    )?;
    let rows = stmt.query_map(params![start, end], |row| {
        Ok(PassageRangeHit {
            id: row.get(0)?,
            source_type: row.get(1)?,
            resource_id: row.get(2)?,
            sub_id: row.get(3)?,
            reference_display: row.get(4)?,
            snippet: row.get(5)?,
            start_verse_code: row.get(6)?,
            end_verse_code: row.get(7)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn expanded_terms(query: &str) -> String {
    let stemmers = [
        Stemmer::create(Algorithm::Spanish),
        Stemmer::create(Algorithm::English),
    ];
    query
        .split_whitespace()
        .flat_map(|term| {
            let clean = term.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
            if clean.is_empty() {
                return Vec::new();
            }
            let mut variants = vec![clean.clone()];
            for stemmer in &stemmers {
                let stem = stemmer.stem(&clean).to_string();
                if !stem.is_empty() && !variants.contains(&stem) {
                    variants.push(stem);
                }
            }
            variants
        })
        .map(|term| format!("\"{term}\""))
        .collect::<Vec<_>>()
        .join(" OR ")
}

pub fn search_notes_sermons(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<UnifiedSearchResult>> {
    let fts = expanded_terms(query);
    if fts.is_empty() {
        return Ok(Vec::new());
    }
    let mut results = Vec::new();
    let mut notes = conn.prepare(
        "SELECT note_id,title,snippet(notes_fts,3,'<b>','</b>','…',64)
         FROM notes_fts WHERE notes_fts MATCH ?1 LIMIT ?2",
    )?;
    let rows = notes.query_map(params![fts, limit as i64], |row| {
        let id: String = row.get(0)?;
        Ok(UnifiedSearchResult {
            source_type: "user_note".to_string(),
            resource_id: id.clone(),
            title: row.get(1)?,
            reference: "Nota de estudio".to_string(),
            snippet: row.get(2)?,
            book: None,
            chapter: None,
            verse: None,
            spine: None,
            note_id: Some(id),
            priority: 0,
        })
    })?;
    for row in rows {
        results.push(row?);
    }
    let mut sermons = conn.prepare(
        "SELECT sermon_id,title,series,snippet(sermons_fts,6,'<b>','</b>','…',64)
         FROM sermons_fts WHERE sermons_fts MATCH ?1 LIMIT ?2",
    )?;
    let rows = sermons.query_map(params![fts, limit as i64], |row| {
        Ok(UnifiedSearchResult {
            source_type: "sermon".to_string(),
            resource_id: row.get::<_, String>(0)?,
            title: row.get(1)?,
            reference: if row.get::<_, String>(2)?.trim().is_empty() {
                "Sermón".to_string()
            } else {
                format!("Serie: {}", row.get::<_, String>(2)?)
            },
            snippet: row.get(3)?,
            book: None,
            chapter: None,
            verse: None,
            spine: None,
            note_id: None,
            priority: 0,
        })
    })?;
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

pub fn search_text_with_stemming(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<UnifiedSearchResult>> {
    let fts = expanded_terms(query);
    if fts.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT g.resource_id, g.module_type, g.reference_key,
                snippet(global_search_index, 3, '<b>', '</b>', '…', 64),
                r.title, r.search_priority
         FROM global_search_index g
         JOIN resources r ON r.id = g.resource_id
         WHERE global_search_index MATCH ?1
         ORDER BY r.search_priority DESC, bm25(global_search_index)
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![fts, limit.clamp(1, 300) as i64], |row| {
        let module_type: String = row.get(1)?;
        let reference: String = row.get(2)?;
        let (book, chapter, verse, spine) = parse_unified_reference(&reference, &module_type);
        Ok(UnifiedSearchResult {
            source_type: module_type,
            resource_id: row.get(0)?,
            title: row.get(4)?,
            reference,
            snippet: row.get(3)?,
            book,
            chapter,
            verse,
            spine,
            note_id: None,
            priority: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn parse_unified_reference(
    reference_key: &str,
    module_type: &str,
) -> (Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
    if reference_key.starts_with("book:") {
        return (None, None, None, reference_key.trim_start_matches("book:").parse().ok());
    }
    if module_type == "dictionary" || reference_key.starts_with("dict:") {
        return (None, None, None, None);
    }
    let parts = reference_key.split(':').collect::<Vec<_>>();
    if parts.len() >= 3 {
        return (
            book_number_from_osis(parts[0]),
            parts[1].parse().ok(),
            parts[2].parse().ok(),
            None,
        );
    }
    (None, None, None, None)
}


#[derive(Debug, Default)]
pub struct QueryDsl {
    pub text: String,
    pub resource: Option<String>,
    pub kind: Option<String>,
    pub strong: Option<String>,
    pub lemma: Option<String>,
    pub passage: Option<String>,
    pub author: Option<String>,
    pub expand_by_strong: bool,
}

pub fn parse_dsl(query: &str) -> QueryDsl {
    let mut dsl = QueryDsl::default();
    let mut remaining = query.to_string();
    if let Some(start) = remaining.find("@pasaje:") {
        let after = &remaining[start + 8..];
        let end = after.find(" @").unwrap_or(after.len());
        dsl.passage = Some(after[..end].trim_matches('"').trim().to_string());
        remaining.replace_range(start..start + 8 + end, " ");
    }
    let mut free = Vec::new();
    for token in remaining.split_whitespace() {
        if let Some(value) = token.strip_prefix("@recurso:") {
            dsl.resource = Some(value.trim_matches('"').to_string());
        } else if let Some(value) = token.strip_prefix("@tipo:") {
            dsl.kind = Some(value.to_lowercase());
        } else if let Some(value) = token.strip_prefix("@strong:") {
            dsl.strong = Some(value.to_uppercase());
            dsl.expand_by_strong = true;
        } else if let Some(value) = token.strip_prefix("@lema:") {
            dsl.lemma = Some(value.trim_matches('"').to_string());
        } else if let Some(value) = token.strip_prefix("@autor:") {
            dsl.author = Some(value.trim_matches('"').to_lowercase());
        } else if token.to_uppercase().starts_with("NEAR(") {
            free.push(token.trim_start_matches("NEAR(").trim_end_matches(')').replace(',', " "));
        } else {
            free.push(token.to_string());
        }
    }
    dsl.text = free.join(" ").trim().to_string();
    dsl
}

fn strong_codes_for_term(conn: &Connection, term: &str) -> Vec<String> {
    let pattern = format!("%{term}%");
    let mut stmt = match conn.prepare(
        "SELECT id FROM strong_entries
         WHERE lower(definition) LIKE lower(?1) OR lower(lemma) LIKE lower(?1)
            OR lower(transliteration) LIKE lower(?1)
         LIMIT 30",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map([pattern], |row| row.get::<_, String>(0));
    rows.map(|rows| rows.filter_map(Result::ok).collect()).unwrap_or_default()
}

pub fn strong_search(
    conn: &Connection,
    term: &str,
    limit: usize,
) -> Result<Vec<UnifiedSearchResult>> {
    let codes = if term.to_uppercase().starts_with('G') || term.to_uppercase().starts_with('H') {
        vec![term.to_uppercase()]
    } else {
        strong_codes_for_term(conn, term)
    };
    let mut results = Vec::new();
    for code in codes.into_iter().take(12) {
        let mut stmt = conn.prepare(
            "SELECT t.book,t.chapter,t.verse,t.lemma,t.surface_text
             FROM interlinear_tokens t WHERE t.strong_number = ?1 LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![code, limit as i64], |row| {
            let book: i64 = row.get(0)?;
            let chapter: i64 = row.get(1)?;
            let verse: i64 = row.get(2)?;
            let lemma: String = row.get(3)?;
            let surface: String = row.get(4)?;
            Ok(UnifiedSearchResult {
                source_type: "bible".to_string(),
                resource_id: format!("strong:{code}"),
                title: format!("{code} · {lemma}"),
                reference: format!("{} {}:{}", osis_code(book), chapter, verse),
                snippet: format!("{surface} · {lemma}"),
                book: Some(book),
                chapter: Some(chapter),
                verse: Some(verse),
                spine: None,
                note_id: None,
                priority: 0,
            })
        })?;
        for row in rows {
            results.push(row?);
        }
    }
    Ok(results)
}

pub fn search_v2(
    conn: &Connection,
    query: &str,
    limit: usize,
    expand_by_strong: bool,
) -> Result<Vec<UnifiedSearchResult>> {
    let dsl = parse_dsl(query);
    let mut results = if dsl.text.is_empty() {
        Vec::new()
    } else {
        search_text_with_stemming(conn, &dsl.text, limit)?
    };
    if !dsl.text.is_empty() {
        results.extend(search_notes_sermons(conn, &dsl.text, limit)?);
    }
    if dsl.expand_by_strong || expand_by_strong {
        let term = dsl.strong.clone().or_else(|| dsl.lemma.clone()).unwrap_or_else(|| dsl.text.clone());
        results.extend(strong_search(conn, &term, limit)?);
    }
    if let Some(passage) = dsl.passage.as_deref() {
        if let Some((book, chapter, verse)) = parse_simple_reference(passage) {
            results.extend(
                passage_range_search(conn, book, chapter, verse, None)?
                    .into_iter()
                    .map(|hit| UnifiedSearchResult {
                        source_type: hit.source_type,
                        resource_id: hit.resource_id,
                        title: "Rango canónico".to_string(),
                        reference: hit.reference_display,
                        snippet: hit.snippet,
                        book: Some(book),
                        chapter: Some(chapter),
                        verse: Some(verse),
                        spine: None,
                        note_id: None,
                        priority: 1,
                    }),
            );
        }
    }
    results.retain(|item| {
        dsl.kind.as_deref().is_none_or(|value| match value {
            "biblia" | "bible" => item.source_type == "bible",
            "comentario" | "commentary" => item.source_type == "commentary",
            "diccionario" | "dictionary" => item.source_type == "dictionary",
            "pbb" | "pbb_book" => item.source_type == "pbb_book",
            "libro" | "book" => item.source_type == "book",
            "nota" | "note" => item.source_type == "user_note",
            "sermon" => item.source_type == "sermon",
            _ => true,
        })
    });
    results.sort_by(|a, b| b.priority.cmp(&a.priority));
    results.dedup_by(|a, b| a.source_type == b.source_type && a.reference == b.reference && a.title == b.title);
    results.truncate(limit.clamp(1, 300));
    Ok(results)
}

fn parse_simple_reference(value: &str) -> Option<(i64, i64, i64)> {
    let normalized = value
        .replace('–', "-")
        .replace('—', "-")
        .replace('.', ":");
    let mut parts = normalized.split_whitespace();
    let mut book_text = parts.next()?.to_string();
    if book_text.chars().all(|c| c.is_ascii_digit()) {
        if let Some(next) = parts.next() {
            book_text.push(' ');
            book_text.push_str(next);
        }
    }
    let rest = parts.next()?;
    let book = all_books()
        .into_iter()
        .find(|book| {
            book.name.eq_ignore_ascii_case(&book_text)
                || book.abbreviation.eq_ignore_ascii_case(&book_text)
                || osis_code(book.number).eq_ignore_ascii_case(&book_text)
        })
        .map(|book| book.number)
        .or_else(|| book_number_from_osis(&book_text))?;
    let (chapter, verse) = rest.split_once(':')?;
    let chapter = chapter.parse::<i64>().ok()?;
    let verse = verse.split('-').next()?.parse::<i64>().ok()?;
    Some((book, chapter, verse))
}
