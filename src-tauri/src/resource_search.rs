use std::sync::LazyLock;

use anyhow::{anyhow, Result};
use regex::Regex;
use serde::Serialize;

use crate::books::BOOKS;
use crate::db::Catalog;
use crate::model::ResourceKind;

static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<[^>]+>").expect("regex"));
static WS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("regex"));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMatch {
    pub kind: String,
    pub title: String,
    pub snippet: String,
    pub book: Option<i64>,
    pub chapter: Option<i64>,
    pub verse: Option<i64>,
    pub spine: Option<i64>,
    pub occurrences: usize,
}

fn fold_char(character: char) -> char {
    match character {
        'á' | 'à' | 'ä' | 'â' | 'Á' | 'À' | 'Ä' | 'Â' => 'a',
        'é' | 'è' | 'ë' | 'ê' | 'É' | 'È' | 'Ë' | 'Ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' | 'Í' | 'Ì' | 'Ï' | 'Î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' | 'Ó' | 'Ò' | 'Ö' | 'Ô' => 'o',
        'ú' | 'ù' | 'ü' | 'û' | 'Ú' | 'Ù' | 'Ü' | 'Û' => 'u',
        'ñ' | 'Ñ' => 'n',
        other => other.to_ascii_lowercase(),
    }
}

fn fold(text: &str) -> String {
    text.chars().map(fold_char).collect()
}

fn glob_pattern(folded: &str) -> String {
    let mut pattern = String::from("*");
    for character in folded.chars() {
        match character {
            'a' => pattern.push_str("[aá]"),
            'e' => pattern.push_str("[eé]"),
            'i' => pattern.push_str("[ií]"),
            'o' => pattern.push_str("[oó]"),
            'u' => pattern.push_str("[uúü]"),
            'n' => pattern.push_str("[nñ]"),
            '*' | '?' | '[' | ']' => {
                pattern.push('[');
                pattern.push(character);
                pattern.push(']');
            }
            _ => pattern.push(character),
        }
    }
    pattern.push('*');
    pattern
}

fn plain_text(html: &str) -> String {
    let text = TAG_RE.replace_all(html, " ");
    WS_RE.replace_all(text.trim(), " ").to_string()
}

fn snippet(html: &str, folded_query: &str) -> (String, usize) {
    let text = plain_text(html);
    let text_chars: Vec<char> = text.chars().collect();
    let folded_chars: Vec<char> = fold(&text).chars().collect();
    let needle: Vec<char> = folded_query.chars().collect();
    if needle.is_empty() || text_chars.is_empty() {
        return (String::new(), 0);
    }

    let mut count = 0usize;
    let mut first: Option<usize> = None;
    let mut index = 0usize;
    while index + needle.len() <= folded_chars.len() {
        if folded_chars[index..index + needle.len()] == needle[..] {
            count += 1;
            if first.is_none() {
                first = Some(index);
            }
            index += needle.len();
        } else {
            index += 1;
        }
    }

    let Some(position) = first else {
        return (text_chars.iter().take(160).collect(), 0);
    };
    let start = position.saturating_sub(60);
    let end = (position + needle.len() + 90).min(text_chars.len());
    let mut value: String = text_chars[start..end].iter().collect();
    if start > 0 {
        value.insert(0, '…');
    }
    if end < text_chars.len() {
        value.push('…');
    }
    (value, count)
}

fn book_label(book: i64) -> String {
    let index = (book - 1).clamp(0, 65) as usize;
    BOOKS.get(index).map(|item| item.0.to_string()).unwrap_or_else(|| format!("Libro {book}"))
}

pub fn search_resource(
    catalog: &Catalog,
    resource_id: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<ResourceMatch>> {
    let resource = catalog
        .get_resource(resource_id)?
        .ok_or_else(|| anyhow!("No se encontró el recurso."))?;
    let trimmed = query.trim();
    if trimmed.chars().count() < 2 {
        return Ok(Vec::new());
    }

    let folded = fold(trimmed);
    let pattern = glob_pattern(&folded);
    let limit = limit.clamp(1, 300);

    if resource.kind == ResourceKind::Bible {
        let conn = catalog.connection();
        let mut statement = conn.prepare(
            "SELECT book, chapter, verse, html FROM verses
             WHERE resource_id = ?1 AND lower(html) GLOB ?2
             ORDER BY book, chapter, verse
             LIMIT ?3",
        )?;
        let rows = statement.query_map(rusqlite::params![resource_id, pattern, limit as i64], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut matches = Vec::new();
        for row in rows {
            let (book, chapter, verse, html) = row?;
            let (value, occurrences) = snippet(&html, &folded);
            matches.push(ResourceMatch {
                kind: "verse".to_string(),
                title: format!("{} {}:{}", book_label(book), chapter, verse),
                snippet: value,
                book: Some(book),
                chapter: Some(chapter),
                verse: Some(verse),
                spine: None,
                occurrences,
            });
        }
        return Ok(matches);
    }

    let conn = catalog.connection();
    let mut statement = conn.prepare(
        "SELECT spine, title, html FROM epub_chapters
         WHERE resource_id = ?1 AND lower(html) GLOB ?2
         ORDER BY spine
         LIMIT ?3",
    )?;
    let rows = statement.query_map(rusqlite::params![resource_id, pattern, limit as i64], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut matches = Vec::new();
    for row in rows {
        let (spine, title, html) = row?;
        let (value, occurrences) = snippet(&html, &folded);
        matches.push(ResourceMatch {
            kind: "chapter".to_string(),
            title,
            snippet: value,
            book: None,
            chapter: None,
            verse: None,
            spine: Some(spine),
            occurrences,
        });
    }
    Ok(matches)
}
