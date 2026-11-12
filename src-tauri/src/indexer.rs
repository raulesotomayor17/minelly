use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};

use crate::books::{book_number_from_osis, osis_code};
use crate::db::Catalog;
use crate::model::{
    GlobalIndexStatus, GlobalSearchHit, IndexReport, PendingIndexResource,
    UnifiedSearchResult,
};

const INDEXABLE_KINDS: &str = "('bible','commentary','dictionary','book')";

pub fn index_resource(connection: &mut Connection, resource_id: &str) -> Result<IndexReport> {
    let (kind, _title): (String, String) = connection
        .query_row(
            "SELECT kind, title FROM resources WHERE id = ?1",
            [resource_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .with_context(|| format!("No existe el recurso {resource_id}"))?;
    let module_type = kind.clone();
    let transaction = connection.transaction()?;
    transaction.execute(
        "DELETE FROM global_search_index WHERE resource_id = ?1",
        [resource_id],
    )?;

    let mut rows_indexed = 0usize;
    {
        let mut insert = transaction.prepare(
            "INSERT INTO global_search_index
                (resource_id, module_type, reference_key, content_text)
             VALUES (?1, ?2, ?3, ?4)",
        )?;
        match kind.as_str() {
            "bible" => {
                let mut statement = transaction.prepare(
                    "SELECT book, chapter, verse, html FROM verses
                     WHERE resource_id = ?1 ORDER BY book, chapter, verse",
                )?;
                let rows = statement.query_map([resource_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })?;
                for row in rows {
                    let (book, chapter, verse, html) = row?;
                    let text = strip_html(&html);
                    if text.is_empty() {
                        continue;
                    }
                    insert.execute(params![
                        resource_id,
                        "bible",
                        format!("{}:{}:{}", osis_code(book), chapter, verse),
                        text,
                    ])?;
                    rows_indexed += 1;
                }
            }
            "commentary" => {
                let mut statement = transaction.prepare(
                    "SELECT book, chapter_start, verse_start, html FROM commentary
                     WHERE resource_id = ?1
                     ORDER BY book, chapter_start, verse_start",
                )?;
                let rows = statement.query_map([resource_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })?;
                for row in rows {
                    let (book, chapter, verse, html) = row?;
                    let text = strip_html(&html);
                    if text.is_empty() {
                        continue;
                    }
                    insert.execute(params![
                        resource_id,
                        "commentary",
                        format!("{}:{}:{}", osis_code(book), chapter, verse),
                        text,
                    ])?;
                    rows_indexed += 1;
                }
            }
            "dictionary" => {
                let mut statement = transaction.prepare(
                    "SELECT topic, html FROM dictionary
                     WHERE resource_id = ?1 ORDER BY topic",
                )?;
                let rows = statement.query_map([resource_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?;
                for row in rows {
                    let (topic, html) = row?;
                    let text = strip_html(&html);
                    if text.is_empty() {
                        continue;
                    }
                    insert.execute(params![
                        resource_id,
                        "dictionary",
                        format!("dict:{topic}"),
                        text,
                    ])?;
                    rows_indexed += 1;
                }
            }
            "book" => {
                let mut statement = transaction.prepare(
                    "SELECT spine, title, html FROM epub_chapters
                     WHERE resource_id = ?1 ORDER BY spine",
                )?;
                let rows = statement.query_map([resource_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?;
                for row in rows {
                    let (spine, title, html) = row?;
                    let body = strip_html(&html);
                    let text = format!("{title} {body}").trim().to_string();
                    if text.is_empty() {
                        continue;
                    }
                    insert.execute(params![
                        resource_id,
                        "book",
                        format!("book:{spine}"),
                        text,
                    ])?;
                    rows_indexed += 1;
                }
            }
            _ => {}
        }
    }

    transaction.execute(
        "UPDATE resources SET indexed = 1 WHERE id = ?1",
        [resource_id],
    )?;
    transaction.commit()?;
    Ok(IndexReport {
        resource_id: resource_id.to_string(),
        module_type,
        rows: rows_indexed,
    })
}

pub fn status_for_catalog(catalog: &Catalog) -> Result<GlobalIndexStatus> {
    index_status(catalog.connection())
}

pub fn search_for_catalog(
    catalog: &Catalog,
    query: &str,
    limit: usize,
) -> Result<Vec<GlobalSearchHit>> {
    global_search(catalog.connection(), query, limit, None)
}

pub fn search_everything_for_catalog(
    catalog: &Catalog,
    query: &str,
    limit: usize,
) -> Result<Vec<UnifiedSearchResult>> {
    search_everything(catalog.connection(), query, limit)
}

pub fn reindex_catalog(catalog: &mut Catalog) -> Result<Vec<IndexReport>> {
    let ids = all_ids(catalog.connection())?;
    let mut reports = Vec::with_capacity(ids.len());
    for id in ids {
        reports.push(index_resource(catalog.connection_mut(), &id)?);
    }
    Ok(reports)
}

pub fn all_ids(connection: &Connection) -> Result<Vec<String>> {
    let mut statement = connection.prepare(&format!(
        "SELECT id FROM resources
         WHERE kind IN {INDEXABLE_KINDS}
         ORDER BY title COLLATE NOCASE"
    ))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn pending_ids(connection: &Connection) -> Result<Vec<String>> {
    let mut statement = connection.prepare(&format!(
        "SELECT id FROM resources
         WHERE kind IN {INDEXABLE_KINDS} AND indexed = 0
         ORDER BY title COLLATE NOCASE"
    ))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn index_status(connection: &Connection) -> Result<GlobalIndexStatus> {
    let mut statement = connection.prepare(&format!(
        "SELECT id, title, kind, indexed FROM resources
         WHERE kind IN {INDEXABLE_KINDS}
         ORDER BY title COLLATE NOCASE"
    ))?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)? != 0,
        ))
    })?;
    let mut pending = Vec::new();
    let mut total_resources = 0i64;
    let mut indexed_resources = 0i64;
    for row in rows {
        let (id, title, kind, indexed) = row?;
        total_resources += 1;
        if indexed {
            indexed_resources += 1;
        } else {
            pending.push(PendingIndexResource {
                id,
                title,
                kind,
                indexed,
            });
        }
    }
    let total_rows: i64 = connection.query_row(
        "SELECT count(*) FROM global_search_index",
        [],
        |row| row.get(0),
    )?;
    Ok(GlobalIndexStatus {
        total_resources,
        indexed_resources,
        pending_resources: pending.len() as i64,
        total_rows,
        pending,
    })
}

pub fn global_search(
    connection: &Connection,
    query: &str,
    limit: usize,
    resource_id: Option<&str>,
) -> Result<Vec<GlobalSearchHit>> {
    let fts_query = build_fts_query(query);
    if fts_query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.clamp(1, 200) as i64;
    let base = "SELECT g.resource_id, g.module_type, g.reference_key,
                       snippet(global_search_index, 3, '<b>', '</b>', '…', 64),
                       bm25(global_search_index)
                FROM global_search_index g
                JOIN resources r ON r.id = g.resource_id
                WHERE global_search_index MATCH ?1";
    let mut hits = Vec::new();
    if let Some(resource_id) = resource_id.filter(|value| !value.trim().is_empty()) {
        let sql = format!("{base} AND g.resource_id = ?2 ORDER BY r.search_priority DESC, bm25(global_search_index) LIMIT ?3");
        let mut statement = connection.prepare(&sql)?;
        let rows = statement.query_map(params![fts_query, resource_id, limit], |row| {
            Ok(GlobalSearchHit {
                resource_id: row.get(0)?,
                module_type: row.get(1)?,
                reference_key: row.get(2)?,
                fragment: row.get(3)?,
                score: row.get(4)?,
            })
        })?;
        for row in rows {
            hits.push(row?);
        }
    } else {
        let sql = format!("{base} ORDER BY r.search_priority DESC, bm25(global_search_index) LIMIT ?2");
        let mut statement = connection.prepare(&sql)?;
        let rows = statement.query_map(params![fts_query, limit], |row| {
            Ok(GlobalSearchHit {
                resource_id: row.get(0)?,
                module_type: row.get(1)?,
                reference_key: row.get(2)?,
                fragment: row.get(3)?,
                score: row.get(4)?,
            })
        })?;
        for row in rows {
            hits.push(row?);
        }
    }
    Ok(hits)
}

fn build_fts_query(query: &str) -> String {
    let tokens = query
        .split_whitespace()
        .map(|token| {
            token
                .trim_matches(|character: char| {
                    !character.is_alphanumeric()
                        && character != '-'
                        && character != '_'
                })
                .replace('"', "")
        })
        .filter(|token| !token.is_empty())
        .map(|token| format!("\"{token}\""))
        .collect::<Vec<_>>();
    tokens.join(" ")
}

pub fn strip_html(html: &str) -> String {
    let mut output = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut characters = html.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '<' => {
                in_tag = true;
                output.push(' ');
            }
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            '&' if !in_tag => {
                let mut entity = String::new();
                while let Some(&next) = characters.peek() {
                    if next == ';' || entity.len() > 10 {
                        break;
                    }
                    entity.push(next);
                    characters.next();
                }
                if characters.peek() == Some(&';') {
                    characters.next();
                }
                output.push_str(&decode_entity(&entity));
            }
            _ if in_tag => {}
            _ => output.push(character),
        }
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn decode_entity(entity: &str) -> String {
    let lower = entity.to_ascii_lowercase();
    let named = match lower.as_str() {
        "amp" => Some("&"),
        "lt" => Some("<"),
        "gt" => Some(">"),
        "quot" => Some("\""),
        "apos" => Some("'"),
        "nbsp" => Some(" "),
        "mdash" => Some("—"),
        "ndash" => Some("–"),
        "hellip" => Some("…"),
        "lsquo" => Some("‘"),
        "rsquo" => Some("’"),
        "ldquo" => Some("“"),
        "rdquo" => Some("”"),
        _ => None,
    };
    if let Some(value) = named {
        return value.to_string();
    }
    if let Some(hex) = lower.strip_prefix("#x") {
        if let Ok(value) = u32::from_str_radix(hex, 16) {
            if let Some(character) = char::from_u32(value) {
                return character.to_string();
            }
        }
    }
    if let Some(decimal) = lower.strip_prefix('#') {
        if let Ok(value) = decimal.parse::<u32>() {
            if let Some(character) = char::from_u32(value) {
                return character.to_string();
            }
        }
    }
    format!("&{entity};")
}

/// Convenience for diagnostics: count indexed rows without loading them.
pub fn indexed_row_count(connection: &Connection) -> Result<i64> {
    Ok(connection.query_row(
        "SELECT count(*) FROM global_search_index",
        [],
        |row| row.get(0),
    )?)
}

/// Only used by the optional `global_index` maintenance binary.
pub fn pending_titles(connection: &Connection) -> Result<Vec<(String, String)>> {
    let mut statement = connection.prepare(&format!(
        "SELECT id, title FROM resources
         WHERE kind IN {INDEXABLE_KINDS} AND indexed = 0
         ORDER BY title COLLATE NOCASE"
    ))?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn search_everything(
    connection: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<UnifiedSearchResult>> {
    let fts_query = build_fts_query(query);
    if fts_query.is_empty() {
        return Ok(Vec::new());
    }
    let per_source = limit.clamp(5, 60);
    let mut results = Vec::new();

    // 1) Índice global para Biblias, comentarios, diccionarios y libros no PBB.
    {
        let mut statement = connection.prepare(
            "SELECT g.resource_id, g.module_type, g.reference_key,
                    snippet(global_search_index, 3, '<b>', '</b>', '…', 64),
                    r.title, r.search_priority
             FROM global_search_index g
             JOIN resources r ON r.id = g.resource_id
             WHERE global_search_index MATCH ?1
               AND r.source_format <> 'pbb'
             ORDER BY r.search_priority DESC, bm25(global_search_index)
             LIMIT ?2",
        )?;
        let rows = statement.query_map(params![fts_query, per_source as i64], |row| {
            let module_type: String = row.get(1)?;
            let reference: String = row.get(2)?;
            let (book, chapter, verse, spine) =
                parse_unified_reference(&reference, &module_type);
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
        for row in rows {
            results.push(row?);
        }
    }

    // 2) pbb_fts para Libros Personales, con el título editorial de pbb_books.
    {
        let mut statement = connection.prepare(
            "SELECT p.resource_id, b.title, p.chapter, p.title,
                    snippet(pbb_fts, 3, '<b>', '</b>', '…', 96), r.search_priority
             FROM pbb_fts p
             JOIN pbb_books b ON b.resource_id = p.resource_id
             JOIN resources r ON r.id = p.resource_id
             WHERE pbb_fts MATCH ?1
               AND b.hidden = 0
             ORDER BY r.search_priority DESC, bm25(pbb_fts)
             LIMIT ?2",
        )?;
        let rows = statement.query_map(params![fts_query, per_source as i64], |row| {
            let chapter_value: rusqlite::types::Value = row.get(2)?;
            let chapter = match chapter_value {
                rusqlite::types::Value::Integer(value) => value,
                rusqlite::types::Value::Text(value) => value.parse().unwrap_or(0),
                _ => 0,
            };
            let chapter_title: String = row.get(3)?;
            Ok(UnifiedSearchResult {
                source_type: "pbb_book".to_string(),
                resource_id: row.get(0)?,
                title: row.get(1)?,
                reference: if chapter_title.trim().is_empty() {
                    format!("Capítulo {}", chapter + 1)
                } else {
                    format!("Capítulo {} · {}", chapter + 1, chapter_title)
                },
                snippet: row.get(4)?,
                book: None,
                chapter: None,
                verse: None,
                spine: Some(chapter),
                note_id: None,
                priority: row.get(5)?,
            })
        })?;
        for row in rows {
            results.push(row?);
        }
    }

    // 3) Notas de usuario: búsqueda LIKE sobre título y content_json.
    {
        let pattern = format!("%{}%", query.trim());
        let mut statement = connection.prepare(
            "SELECT id, title, content_json FROM notes
             WHERE lower(title) LIKE lower(?1)
                OR lower(content_json) LIKE lower(?2)
             ORDER BY updated_at DESC
             LIMIT ?3",
        )?;
        let rows = statement.query_map(params![pattern, pattern, per_source as i64], |row| {
            let id: String = row.get(0)?;
            let title: String = row.get(1)?;
            let content_json: String = row.get(2)?;
            Ok((id, title, content_json))
        })?;
        for row in rows {
            let (id, title, content_json) = row?;
            let mut text = String::new();
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content_json) {
                collect_json_text(&value, &mut text);
            }
            let full_text = format!("{title} {text}").trim().to_string();
            results.push(UnifiedSearchResult {
                source_type: "user_note".to_string(),
                resource_id: id.clone(),
                title: if title.trim().is_empty() {
                    "Nota sin título".to_string()
                } else {
                    title
                },
                reference: "Nota de estudio".to_string(),
                snippet: highlight_text(&full_text, query, 260),
                book: None,
                chapter: None,
                verse: None,
                spine: None,
                note_id: Some(id),
                priority: 0,
            });
        }
    }

    Ok(results)
}

fn parse_unified_reference(
    reference_key: &str,
    module_type: &str,
) -> (Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
    if reference_key.starts_with("book:") {
        return (
            None,
            None,
            None,
            reference_key
                .trim_start_matches("book:")
                .parse::<i64>()
                .ok(),
        );
    }
    if module_type == "dictionary" || reference_key.starts_with("dict:") {
        return (None, None, None, None);
    }
    let parts = reference_key.split(':').collect::<Vec<_>>();
    if parts.len() >= 3 {
        return (
            book_number_from_osis(parts[0]),
            parts[1].parse::<i64>().ok(),
            parts[2].parse::<i64>().ok(),
            None,
        );
    }
    (None, None, None, None)
}

fn collect_json_text(value: &serde_json::Value, output: &mut String) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(serde_json::Value::as_str) {
                output.push_str(text);
                output.push(' ');
            }
            for (key, child) in map {
                if key == "attrs" {
                    continue;
                }
                collect_json_text(child, output);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_json_text(item, output);
            }
        }
        _ => {}
    }
}

fn highlight_text(text: &str, query: &str, max_chars: usize) -> String {
    let terms = query
        .split_whitespace()
        .map(|term| term.trim().to_string())
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    let lower = text.to_lowercase();
    let first = terms
        .iter()
        .filter_map(|term| lower.find(&term.to_lowercase()))
        .min()
        .unwrap_or(0);
    let mut start = first.saturating_sub(80);
    while start > 0 && !text.is_char_boundary(start) {
        start -= 1;
    }
    let mut end = (start + max_chars).min(text.len());
    while end > start && !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut snippet = html_escape(&text[start..end]).trim().to_string();
    for term in &terms {
        if let Ok(regex) = regex::RegexBuilder::new(&regex::escape(term))
            .case_insensitive(true)
            .build()
        {
            snippet = regex
                .replace_all(&snippet, |caps: &regex::Captures| {
                    format!("<b>{}</b>", &caps[0])
                })
                .to_string();
        }
    }
    if end < text.len() {
        snippet.push('…');
    }
    snippet
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
