use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};

use crate::model::{BookBookmark, ReadingProgress};
use crate::db::now_epoch;

fn chapter_total(conn: &Connection, resource_id: &str) -> i64 {
    conn.query_row(
        "SELECT count(*) FROM epub_chapters WHERE resource_id = ?1",
        [resource_id],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0)
    .max(1)
}

fn percent(conn: &Connection, resource_id: &str, spine: i64, completed: &[i64]) -> f64 {
    let total = chapter_total(conn, resource_id) as f64;
    let value = if completed.is_empty() {
        (spine as f64 / total) * 100.0
    } else {
        (completed.len() as f64 / total) * 100.0
    };
    value.clamp(0.0, 100.0)
}

pub fn progress_get(conn: &Connection, resource_id: &str) -> Result<Option<ReadingProgress>> {
    Ok(conn
        .query_row(
            "SELECT resource_id, spine, paragraph_index, scroll_ratio, completed_spines_json,
                    overall_percent, updated_at FROM reading_progress WHERE resource_id = ?1",
            [resource_id],
            |row| {
                let completed: String = row.get(4)?;
                Ok(ReadingProgress {
                    resource_id: row.get(0)?,
                    spine: row.get(1)?,
                    paragraph_index: row.get(2)?,
                    scroll_ratio: row.get(3)?,
                    completed_spines: serde_json::from_str(&completed).unwrap_or_default(),
                    overall_percent: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .optional()?)
}

pub fn progress_list(conn: &Connection) -> Result<Vec<ReadingProgress>> {
    let mut stmt = conn.prepare(
        "SELECT resource_id, spine, paragraph_index, scroll_ratio, completed_spines_json,
                overall_percent, updated_at FROM reading_progress ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let completed: String = row.get(4)?;
        Ok(ReadingProgress {
            resource_id: row.get(0)?,
            spine: row.get(1)?,
            paragraph_index: row.get(2)?,
            scroll_ratio: row.get(3)?,
            completed_spines: serde_json::from_str(&completed).unwrap_or_default(),
            overall_percent: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn progress_save(
    conn: &Connection,
    resource_id: &str,
    spine: i64,
    paragraph_index: i64,
    scroll_ratio: f64,
) -> Result<ReadingProgress> {
    let existing = progress_get(conn, resource_id)?;
    let completed = existing.map(|p| p.completed_spines).unwrap_or_default();
    let overall = percent(conn, resource_id, spine, &completed);
    conn.execute(
        "INSERT INTO reading_progress
            (resource_id, spine, paragraph_index, scroll_ratio, completed_spines_json, overall_percent, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(resource_id) DO UPDATE SET
            spine=excluded.spine, paragraph_index=excluded.paragraph_index,
            scroll_ratio=excluded.scroll_ratio, overall_percent=excluded.overall_percent,
            updated_at=excluded.updated_at",
        params![resource_id, spine, paragraph_index, scroll_ratio, serde_json::to_string(&completed)?, overall, now_epoch()],
    )?;
    progress_get(conn, resource_id)?.ok_or_else(|| anyhow::anyhow!("No se pudo guardar el progreso"))
}

pub fn toggle_completed(
    conn: &Connection,
    resource_id: &str,
    spine: i64,
    completed: bool,
) -> Result<ReadingProgress> {
    let existing = progress_get(conn, resource_id)?;
    let mut spines = existing.as_ref().map(|p| p.completed_spines.clone()).unwrap_or_default();
    if completed {
        if !spines.contains(&spine) { spines.push(spine); }
    } else {
        spines.retain(|item| *item != spine);
    }
    spines.sort_unstable();
    let current_spine = existing.map(|p| p.spine).unwrap_or(spine);
    let overall = percent(conn, resource_id, current_spine, &spines);
    conn.execute(
        "INSERT INTO reading_progress
            (resource_id, spine, paragraph_index, scroll_ratio, completed_spines_json, overall_percent, updated_at)
         VALUES (?1,?2,0,0.0,?3,?4,?5)
         ON CONFLICT(resource_id) DO UPDATE SET
            completed_spines_json=excluded.completed_spines_json,
            overall_percent=excluded.overall_percent, updated_at=excluded.updated_at",
        params![resource_id, current_spine, serde_json::to_string(&spines)?, overall, now_epoch()],
    )?;
    progress_get(conn, resource_id)?.ok_or_else(|| anyhow::anyhow!("No se pudo actualizar el capítulo"))
}

pub fn bookmark_add(
    conn: &Connection,
    resource_id: &str,
    spine: i64,
    paragraph_index: i64,
    scroll_ratio: f64,
    label: &str,
    note: &str,
    excerpt: &str,
    primary: bool,
    bible_book: Option<i64>,
    bible_chapter: Option<i64>,
    bible_verse: Option<i64>,
    snippet: &str,
    color: &str,
) -> Result<BookBookmark> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_epoch();
    if primary {
        conn.execute(
            "UPDATE book_bookmarks SET is_primary_ribbon = 0 WHERE resource_id = ?1",
            [resource_id],
        )?;
    }
    conn.execute(
        "INSERT INTO book_bookmarks
            (id, resource_id, spine, paragraph_index, scroll_ratio, label, note, excerpt,
             is_primary_ribbon, bible_book, bible_chapter, bible_verse, snippet, color, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        params![id, resource_id, spine, paragraph_index, scroll_ratio, label, note, excerpt, primary as i64, bible_book, bible_chapter, bible_verse, snippet, color, now, now],
    )?;
    Ok(BookBookmark {
        id, resource_id: resource_id.to_string(), spine, paragraph_index, scroll_ratio,
        label: label.to_string(), note: note.to_string(), excerpt: excerpt.to_string(),
        is_primary_ribbon: primary, bible_book, bible_chapter, bible_verse,
        snippet: snippet.to_string(), color: color.to_string(), created_at: now, updated_at: now,
    })
}

pub fn bookmark_list(conn: &Connection, resource_id: &str) -> Result<Vec<BookBookmark>> {
    let mut stmt = conn.prepare(
        "SELECT id, resource_id, spine, paragraph_index, scroll_ratio, label, note, excerpt,
                is_primary_ribbon, bible_book, bible_chapter, bible_verse, snippet, color, created_at, updated_at FROM book_bookmarks
         WHERE resource_id = ?1 ORDER BY is_primary_ribbon DESC, spine, paragraph_index",
    )?;
    let rows = stmt.query_map([resource_id], |row| {
        Ok(BookBookmark {
            id: row.get(0)?, resource_id: row.get(1)?, spine: row.get(2)?,
            paragraph_index: row.get(3)?, scroll_ratio: row.get(4)?,
            label: row.get(5)?, note: row.get(6)?, excerpt: row.get(7)?,
            is_primary_ribbon: row.get::<_, i64>(8)? != 0,
            bible_book: row.get(9)?, bible_chapter: row.get(10)?, bible_verse: row.get(11)?,
            snippet: row.get(12)?, color: row.get(13)?, created_at: row.get(14)?, updated_at: row.get(15)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn bookmark_delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM book_bookmarks WHERE id = ?1", [id])?;
    Ok(())
}
