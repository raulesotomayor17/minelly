use anyhow::Result;
use rusqlite::params_from_iter;

use crate::books::{book_name, BOOKS};
use crate::db::Catalog;
use crate::model::RagContext;

pub fn retrieve(catalog: &Catalog, query: &str, limit: usize) -> Result<Vec<RagContext>> {
    let terms = search_terms(query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let patterns = terms
        .iter()
        .map(|term| format!("%{}%", escape_like(term)))
        .collect::<Vec<_>>();
    let clause = (0..terms.len())
        .map(|_| "html LIKE ? ESCAPE '\\'")
        .collect::<Vec<_>>()
        .join(" OR ");
    let book_filter = detect_book(query);
    let verse_book_clause = book_filter
        .map(|book| format!(" AND v.book = {book}"))
        .unwrap_or_default();
    let commentary_book_clause = book_filter
        .map(|book| format!(" AND c.book = {book}"))
        .unwrap_or_default();
    let mut contexts = Vec::new();

    {
        let sql = format!(
            "SELECT v.resource_id, r.title, v.book, v.chapter, v.verse, v.html
             FROM verses v JOIN resources r ON r.id = v.resource_id
             WHERE ({clause}){verse_book_clause}
             ORDER BY r.search_priority DESC, v.book, v.chapter, v.verse LIMIT 2"
        );
        let mut statement = catalog.connection().prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(patterns.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?;
        for row in rows {
            let (resource_id, resource_title, book, chapter, verse, html) = row?;
            contexts.push(RagContext {
                id: format!("verse:{resource_id}:{book}:{chapter}:{verse}"),
                kind: "bible".to_string(),
                resource_id,
                resource_title,
                label: format!("{} {}:{}", book_name(book), chapter, verse),
                text: truncate(&strip_tags(&html), 1100),
                book,
                chapter,
                verse,
                spine: 0,
            });
        }
    }

    {
        let sql = format!(
            "SELECT c.resource_id, r.title, c.book, c.chapter_start, c.verse_start, c.html
             FROM commentary c JOIN resources r ON r.id = c.resource_id
             WHERE ({clause}){commentary_book_clause}
             ORDER BY r.search_priority DESC, c.book, c.chapter_start, c.verse_start LIMIT 2"
        );
        let mut statement = catalog.connection().prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(patterns.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?;
        for row in rows {
            let (resource_id, resource_title, book, chapter, verse, html) = row?;
            contexts.push(RagContext {
                id: format!("commentary:{resource_id}:{book}:{chapter}:{verse}"),
                kind: "commentary".to_string(),
                resource_id,
                resource_title,
                label: format!("{} {}:{}", book_name(book), chapter, verse),
                text: truncate(&strip_tags(&html), 1100),
                book,
                chapter,
                verse,
                spine: 0,
            });
        }
    }

    {
        let sql = format!(
            "SELECT d.resource_id, r.title, d.topic, d.html
             FROM dictionary d JOIN resources r ON r.id = d.resource_id
             WHERE {clause} ORDER BY r.search_priority DESC, d.topic LIMIT 1"
        );
        let mut statement = catalog.connection().prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(patterns.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        for row in rows {
            let (resource_id, resource_title, topic, html) = row?;
            contexts.push(RagContext {
                id: format!("dictionary:{resource_id}:{topic}"),
                kind: "dictionary".to_string(),
                resource_id,
                resource_title,
                label: topic,
                text: truncate(&strip_tags(&html), 900),
                book: 0,
                chapter: 0,
                verse: 0,
                spine: 0,
            });
        }
    }

    {
        let sql = format!(
            "SELECT e.resource_id, r.title, e.spine, e.title, e.html
             FROM epub_chapters e JOIN resources r ON r.id = e.resource_id
             WHERE {clause} ORDER BY r.search_priority DESC, e.resource_id, e.spine LIMIT 2"
        );
        let mut statement = catalog.connection().prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(patterns.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?;
        for row in rows {
            let (resource_id, resource_title, spine, title, html) = row?;
            contexts.push(RagContext {
                id: format!("book:{resource_id}:{spine}"),
                kind: "book".to_string(),
                resource_id,
                resource_title,
                label: title,
                text: truncate(&strip_tags(&html), 1100),
                book: 0,
                chapter: 0,
                verse: 0,
                spine,
            });
        }
    }

    contexts.truncate(limit.max(1).min(10));
    Ok(contexts)
}

fn search_terms(query: &str) -> Vec<String> {
    const STOPWORDS: [&str; 18] = [
        "que", "dice", "sobre", "del", "las", "los", "una", "con", "por", "para", "como",
        "mis", "biblioteca", "qué", "cuál", "cuales", "cuáles", "hay",
    ];
    let mut terms = query
        .split(|character: char| {
            !character.is_alphanumeric()
                && character != 'á'
                && character != 'é'
                && character != 'í'
                && character != 'ó'
                && character != 'ú'
                && character != 'ñ'
        })
        .filter(|term| term.chars().count() > 2)
        .map(|term| term.to_lowercase())
        .filter(|term| !STOPWORDS.contains(&term.as_str()))
        .collect::<Vec<_>>();
    terms.sort();
    terms.dedup();
    terms.truncate(8);
    terms
}

fn detect_book(query: &str) -> Option<i64> {
    let normalized = query.to_lowercase();
    BOOKS
        .iter()
        .enumerate()
        .filter(|(_, (name, abbreviation))| {
            normalized.contains(&name.to_lowercase())
                || normalized
                    .split(|character: char| !character.is_alphanumeric())
                    .any(|token| token == abbreviation.to_lowercase())
        })
        .max_by_key(|(_, (name, _))| name.chars().count())
        .map(|(index, _)| index as i64 + 1)
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn strip_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for character in html.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                result.push(' ');
            }
            _ if !in_tag => result.push(character),
            _ => {}
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    format!("{}…", value.chars().take(max).collect::<String>())
}
