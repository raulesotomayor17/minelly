use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};

use crate::model::{
    LexiconMatch, StrongEntry, WordOccurrence, WordStudyCount, WordStudyResult,
};

fn normalize_strong(value: &str) -> String {
    let clean = value.trim().to_ascii_uppercase();
    let (prefix, digits) = if let Some(rest) = clean.strip_prefix('G') {
        ("G", rest)
    } else if let Some(rest) = clean.strip_prefix('H') {
        ("H", rest)
    } else if clean.chars().all(|c| c.is_ascii_digit()) {
        ("G", clean.as_str())
    } else {
        return clean;
    };
    if let Ok(number) = digits.parse::<u32>() {
        format!("{prefix}{number}")
    } else {
        clean
    }
}

pub fn entry(connection: &Connection, strong: &str) -> Result<Option<StrongEntry>> {
    let id = normalize_strong(strong);
    let entry = connection
        .query_row(
            "SELECT id, language, lemma, transliteration, pronunciation, definition,
                    derivation, kjv, html, source
             FROM strong_entries WHERE id = ?1",
            [id],
            row_to_entry,
        )
        .optional()?;
    Ok(entry)
}

pub fn study(connection: &Connection, strong: &str, limit: usize) -> Result<WordStudyResult> {
    let id = normalize_strong(strong);
    let entry = entry(connection, &id)?;
    let mut statement = connection.prepare(
        "SELECT source, COUNT(*) FROM word_occurrences
         WHERE strong_number = ?1 GROUP BY source ORDER BY source",
    )?;
    let counts = statement
        .query_map([id.as_str()], |row| {
            Ok(WordStudyCount {
                source: row.get(0)?,
                count: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut statement = connection.prepare(
        "SELECT source, strong_number, book, chapter, verse, word_order, word, lemma,
                transliteration, morphology
         FROM word_occurrences WHERE strong_number = ?1
         ORDER BY source, book, chapter, verse, word_order LIMIT ?2",
    )?;
    let occurrences = statement
        .query_map(params![id, limit.clamp(1, 250) as i64], row_to_occurrence)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let lexicons = lexicons_for(connection, &id)?;
    Ok(WordStudyResult {
        entry,
        counts,
        occurrences,
        lexicons,
    })
}

pub fn search(connection: &Connection, query: &str, limit: usize) -> Result<Vec<StrongEntry>> {
    let pattern = format!("%{}%", query.trim());
    let mut statement = connection.prepare(
        "SELECT id, language, lemma, transliteration, pronunciation, definition,
                derivation, kjv, html, source
         FROM strong_entries
         WHERE id LIKE ?1 OR lemma LIKE ?1 OR transliteration LIKE ?1 OR definition LIKE ?1
         ORDER BY CASE WHEN id = ?2 THEN 0 ELSE 1 END, id
         LIMIT ?3",
    )?;
    let rows = statement.query_map(
        params![pattern, normalize_strong(query), limit.clamp(1, 100) as i64],
        row_to_entry,
    )?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn reference(
    connection: &Connection,
    book: i64,
    chapter: i64,
    verse: i64,
) -> Result<Vec<WordOccurrence>> {
    let mut statement = connection.prepare(
        "SELECT source, strong_number, book, chapter, verse, word_order, word, lemma,
                transliteration, morphology
         FROM word_occurrences
         WHERE book = ?1 AND chapter = ?2 AND verse = ?3
         ORDER BY source, word_order",
    )?;
    let rows = statement.query_map(params![book, chapter, verse], row_to_occurrence)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn lexicons_for(connection: &Connection, strong: &str) -> Result<Vec<LexiconMatch>> {
    let mut statement = connection.prepare(
        "SELECT r.id, r.title, d.topic, substr(d.html, 1, 16000)
         FROM dictionary d
         JOIN resources r ON r.id = d.resource_id
         WHERE d.topic = ?1 AND r.kind = 'dictionary'
         ORDER BY CASE WHEN r.id = 'mysword:strong-plus.dct.mybible' THEN 0 ELSE 1 END,
                  r.title
         LIMIT 8",
    )?;
    let rows = statement.query_map([strong], |row| {
        Ok(LexiconMatch {
            resource_id: row.get(0)?,
            resource_title: row.get(1)?,
            topic: row.get(2)?,
            html: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<StrongEntry> {
    Ok(StrongEntry {
        id: row.get(0)?,
        language: row.get(1)?,
        lemma: row.get(2)?,
        transliteration: row.get(3)?,
        pronunciation: row.get(4)?,
        definition: row.get(5)?,
        derivation: row.get(6)?,
        kjv: row.get(7)?,
        html: row.get(8)?,
        source: row.get(9)?,
    })
}

fn row_to_occurrence(row: &rusqlite::Row<'_>) -> rusqlite::Result<WordOccurrence> {
    Ok(WordOccurrence {
        source: row.get(0)?,
        strong_number: row.get(1)?,
        book: row.get(2)?,
        chapter: row.get(3)?,
        verse: row.get(4)?,
        word_order: row.get(5)?,
        word: row.get(6)?,
        lemma: row.get(7)?,
        transliteration: row.get(8)?,
        morphology: row.get(9)?,
    })
}
