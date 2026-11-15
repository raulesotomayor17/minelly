use std::collections::HashSet;

use anyhow::{Context, Result};
use regex::Regex;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde_json::Value;
use uuid::Uuid;

use crate::db::now_epoch;
use crate::model::{
    Anchor, AnchorInput, AnnotationBundle, Highlight, Note, NoteExportTagLink, NoteFilter,
    NoteInput, NoteSummary, Notebook, Tag, UgcBundle,
};

pub fn list_notebooks(conn: &Connection) -> Result<Vec<Notebook>> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, name, color, created_at, updated_at,
                node_type, icon, sort_order, origin_uuid, shared_by
         FROM notebooks ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Notebook {
            id: row.get(0)?,
            parent_id: row.get(1)?,
            name: row.get(2)?,
            color: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            node_type: row.get(6)?,
            icon: row.get(7)?,
            sort_order: row.get(8)?,
            origin_uuid: row.get(9)?,
            shared_by: row.get(10)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn create_notebook(
    conn: &Connection,
    name: &str,
    parent_id: Option<String>,
    color: Option<String>,
) -> Result<Notebook> {
    let id = Uuid::new_v4().to_string();
    let now = now_epoch();
    let parent = parent_id.filter(|value| !value.trim().is_empty());
    conn.execute(
        "INSERT INTO notebooks (id, parent_id, name, color, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            parent,
            name.trim(),
            color.unwrap_or_else(|| "#5B95FF".to_string()),
            now,
            now
        ],
    )?;
    get_notebook(conn, &id)?.context("no se pudo crear el cuaderno")
}

pub fn update_notebook(
    conn: &Connection,
    id: &str,
    name: &str,
    parent_id: Option<String>,
    color: Option<String>,
) -> Result<Notebook> {
    let parent = parent_id.filter(|value| !value.trim().is_empty() && value != id);
    conn.execute(
        "UPDATE notebooks SET name = ?2, parent_id = ?3, color = COALESCE(?4, color),
         updated_at = ?5 WHERE id = ?1",
        params![id, name.trim(), parent, color, now_epoch()],
    )?;
    get_notebook(conn, id)?.context("no existe el cuaderno")
}

pub fn get_notebook(conn: &Connection, id: &str) -> Result<Option<Notebook>> {
    Ok(conn
        .query_row(
            "SELECT id, parent_id, name, color, created_at, updated_at,
                    node_type, icon, sort_order, origin_uuid, shared_by
             FROM notebooks WHERE id = ?1",
            [id],
            |row| {
                Ok(Notebook {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    node_type: row.get(6)?,
                    icon: row.get(7)?,
                    sort_order: row.get(8)?,
                    origin_uuid: row.get(9)?,
                    shared_by: row.get(10)?,
                })
            },
        )
        .optional()?)
}

pub fn delete_notebook(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM notebooks WHERE id = ?1", [id])?;
    Ok(())
}

pub fn list_tags(conn: &Connection) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, COUNT(nt.note_id)
         FROM tags t LEFT JOIN note_tags nt ON nt.tag_id = t.id
         GROUP BY t.id, t.name ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            count: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn create_tag(conn: &Connection, name: &str) -> Result<Tag> {
    let name = name.trim();
    if name.is_empty() {
        return Err(anyhow::anyhow!("El nombre de la etiqueta está vacío."));
    }
    if let Some(tag) = conn
        .query_row(
            "SELECT id, name, 0 FROM tags WHERE name = ?1",
            [name],
            |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    count: row.get(2)?,
                })
            },
        )
        .optional()?
    {
        return Ok(tag);
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![id, name, now_epoch()],
    )?;
    Ok(Tag {
        id,
        name: name.to_string(),
        count: 0,
    })
}

pub fn delete_tag(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM tags WHERE id = ?1", [id])?;
    Ok(())
}

pub fn list_notes(conn: &Connection, filter: &NoteFilter) -> Result<Vec<NoteSummary>> {
    let mut sql = String::from(
        "SELECT n.id, n.notebook_id, n.title, n.content_json, n.created_at, n.updated_at,
                n.origin_uuid, n.author_name, n.sort_order
         FROM notes n",
    );
    let mut conditions = Vec::new();
    let mut values = Vec::new();

    if filter.tag_id.as_deref().is_some_and(|value| !value.is_empty()) {
        sql.push_str(" JOIN note_tags nt ON nt.note_id = n.id");
        conditions.push("nt.tag_id = ?".to_string());
        values.push(filter.tag_id.clone().unwrap_or_default());
    }
    if let Some(notebook) = filter.notebook_id.as_deref().filter(|value| !value.is_empty()) {
        conditions.push(
            "n.notebook_id IN (WITH RECURSIVE tree(id) AS (
                SELECT ?1
                UNION ALL
                SELECT child.id FROM notebooks child JOIN tree parent ON child.parent_id = parent.id
             ) SELECT id FROM tree)"
                .to_string(),
        );
        values.push(notebook.to_string());
    }
    if let Some(query) = filter.query.as_deref().filter(|value| !value.trim().is_empty()) {
        conditions.push("(n.title LIKE ? OR n.content_json LIKE ?)".to_string());
        let like = format!("%{}%", query.trim());
        values.push(like.clone());
        values.push(like);
    }
    if let Some(anchor) = filter.anchor_uri.as_deref().filter(|value| !value.is_empty()) {
        conditions.push(
            "EXISTS (SELECT 1 FROM anchors a WHERE a.target_id = n.id
             AND a.target_type = 'note' AND a.anchor_uri = ?)"
                .to_string(),
        );
        values.push(anchor.to_string());
    }
    if !conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
    }
    sql.push_str(" ORDER BY n.updated_at DESC, n.title COLLATE NOCASE");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(values.iter()), |row| {
        let content: String = row.get(3)?;
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?,
            excerpt(&content),
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, String>(7)?,
            row.get::<_, i64>(8)?,
        ))
    })?;
    let mut summaries = Vec::new();
    for row in rows {
        let (id, notebook_id, title, excerpt, created_at, updated_at, origin_uuid, author_name, sort_order) = row?;
        summaries.push(NoteSummary {
            id: id.clone(),
            notebook_id,
            title,
            excerpt,
            created_at,
            updated_at,
            origin_uuid,
            author_name,
            sort_order,
            tags: note_tags(conn, &id)?,
            anchors: note_anchors(conn, &id)?,
        });
    }
    Ok(summaries)
}

pub fn get_note(conn: &Connection, id: &str) -> Result<Option<Note>> {
    let row = conn
        .query_row(
            "SELECT id, notebook_id, title, content_json, created_at, updated_at,
                    origin_uuid, author_name, sort_order
             FROM notes WHERE id = ?1",
            [id],
            |row| {
                let content: String = row.get(3)?;
                Ok(Note {
                    id: row.get(0)?,
                    notebook_id: row.get(1)?,
                    title: row.get(2)?,
                    content_json: serde_json::from_str(&content)
                        .unwrap_or_else(|_| Value::Object(Default::default())),
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    origin_uuid: row.get(6)?,
                    author_name: row.get(7)?,
                    sort_order: row.get(8)?,
                    tags: Vec::new(),
                    anchors: Vec::new(),
                })
            },
        )
        .optional()?;
    let Some(mut note) = row else {
        return Ok(None);
    };
    note.tags = note_tags(conn, id)?;
    note.anchors = note_anchors(conn, id)?;
    Ok(Some(note))
}

fn collect_wiki_text(value: &serde_json::Value, output: &mut String) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(serde_json::Value::as_str) {
                output.push_str(text);
                output.push(' ');
            }
            for (key, child) in map {
                if key != "attrs" {
                    collect_wiki_text(child, output);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_wiki_text(item, output);
            }
        }
        _ => {}
    }
}

pub fn sync_note_links(conn: &Connection, note_id: &str) -> Result<()> {
    conn.execute("DELETE FROM note_links WHERE source_note_id = ?1", [note_id])?;
    let content: String = conn
        .query_row("SELECT content_json FROM notes WHERE id = ?1", [note_id], |row| row.get(0))
        .unwrap_or_else(|_| "{}".to_string());
    let mut text = String::new();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
        collect_wiki_text(&value, &mut text);
    }
    let pattern = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    for capture in pattern.captures_iter(&text) {
        let target = capture.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        if target.is_empty() {
            continue;
        }
        let is_scripture = Regex::new(r"^\d?\s*[A-Za-zÁÉÍÓÚÑáéíóúñ]+\s+\d+:\d+").unwrap().is_match(target);
        let target_type = if is_scripture { "scripture" } else { "note" };
        conn.execute(
            "INSERT OR IGNORE INTO note_links(source_note_id, target_type, target_key)
             VALUES (?1, ?2, ?3)",
            params![note_id, target_type, target],
        )?;
    }
    Ok(())
}

pub fn note_backlinks(conn: &Connection, note_id: &str) -> Result<Vec<NoteSummary>> {
    let title: String = conn
        .query_row("SELECT title FROM notes WHERE id = ?1", [note_id], |row| row.get(0))
        .unwrap_or_default();
    let mut stmt = conn.prepare(
        "SELECT DISTINCT n.id FROM note_links l JOIN notes n ON n.id = l.source_note_id
         WHERE l.target_type = 'note' AND (l.target_key = ?1 OR l.target_key = ?2)
         ORDER BY n.updated_at DESC",
    )?;
    let ids = stmt.query_map(params![note_id, title], |row| row.get::<_, String>(0))?;
    let mut result = Vec::new();
    for id in ids {
        let id = id?;
        if let Some(note) = get_note(conn, &id)? {
            result.push(NoteSummary {
                id: note.id,
                notebook_id: note.notebook_id,
                title: note.title,
                excerpt: String::new(),
                created_at: note.created_at,
                updated_at: note.updated_at,
                origin_uuid: note.origin_uuid,
                author_name: note.author_name,
                sort_order: note.sort_order,
                tags: note.tags,
                anchors: note.anchors,
            });
        }
    }
    Ok(result)
}

pub fn move_notebook(conn: &Connection, id: &str, parent_id: Option<&str>, sort_order: i64) -> Result<()> {
    conn.execute(
        "UPDATE notebooks SET parent_id = ?2, sort_order = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, parent_id, sort_order, now_epoch()],
    )?;
    Ok(())
}

pub fn move_note(conn: &Connection, id: &str, notebook_id: Option<&str>, sort_order: i64) -> Result<()> {
    conn.execute(
        "UPDATE notes SET notebook_id = ?2, sort_order = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, notebook_id, sort_order, now_epoch()],
    )?;
    crate::indexer_v2::sync_note_fts(conn, id)?;
    Ok(())
}

/// Algunas vistas envían el documento TipTap ya serializado como texto.
/// Se normaliza para que la base guarde siempre un objeto JSON.
fn normalized_content(value: &Value) -> Value {
    if let Value::String(raw) = value {
        let trimmed = raw.trim();
        if trimmed.starts_with('{') || trimmed.starts_with('[') {
            if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
                return parsed;
            }
        }
    }
    value.clone()
}

pub fn create_note(conn: &Connection, input: &NoteInput) -> Result<Note> {
    insert_note(conn, &Uuid::new_v4().to_string(), input)
}

fn insert_note(conn: &Connection, id: &str, input: &NoteInput) -> Result<Note> {
    let now = now_epoch();
    let notebook = input
        .notebook_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    conn.execute(
        "INSERT INTO notes (id, notebook_id, title, content_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            notebook,
            if input.title.trim().is_empty() {
                "Sin título"
            } else {
                input.title.trim()
            },
            serde_json::to_string(&normalized_content(&input.content_json))?,
            now,
            now
        ],
    )?;
    set_note_tags(conn, id, &input.tags)?;
    set_note_anchors(conn, id, &input.anchors)?;
    sync_note_links(conn, id)?;
    crate::indexer_v2::sync_note_fts(conn, id)?;
    get_note(conn, id)?.context("no se pudo crear la nota")
}

/// Crea o actualiza una nota según el `id` recibido. Es el punto de entrada de
/// las notas flotantes, del panel lateral y de los paneles del Lienzo.
pub fn upsert_note(conn: &Connection, input: &NoteInput) -> Result<Note> {
    let requested = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(id) = requested {
        let existing: Option<String> = conn
            .query_row("SELECT id FROM notes WHERE id = ?1", [id], |row| row.get(0))
            .optional()?;
        return match existing {
            Some(_) => update_note(conn, id, input),
            None => insert_note(conn, id, input),
        };
    }
    create_note(conn, input)
}

pub fn update_note(conn: &Connection, id: &str, input: &NoteInput) -> Result<Note> {
    let notebook = input
        .notebook_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    conn.execute(
        "UPDATE notes SET notebook_id = ?2, title = ?3, content_json = ?4, updated_at = ?5
         WHERE id = ?1",
        params![
            id,
            notebook,
            if input.title.trim().is_empty() {
                "Sin título"
            } else {
                input.title.trim()
            },
            serde_json::to_string(&normalized_content(&input.content_json))?,
            now_epoch()
        ],
    )?;
    set_note_tags(conn, id, &input.tags)?;
    set_note_anchors(conn, id, &input.anchors)?;
    sync_note_links(conn, id)?;
    crate::indexer_v2::sync_note_fts(conn, id)?;
    get_note(conn, id)?.context("no existe la nota")
}

pub fn delete_note(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
    conn.execute("DELETE FROM notes_fts WHERE note_id = ?1", [id])?;
    Ok(())
}

pub fn set_note_tags(conn: &Connection, note_id: &str, names: &[String]) -> Result<()> {
    conn.execute("DELETE FROM note_tags WHERE note_id = ?1", [note_id])?;
    for name in names {
        if name.trim().is_empty() {
            continue;
        }
        let tag = create_tag(conn, name)?;
        conn.execute(
            "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
            params![note_id, tag.id],
        )?;
    }
    Ok(())
}

pub fn set_note_anchors(conn: &Connection, note_id: &str, anchors: &[AnchorInput]) -> Result<()> {
    conn.execute(
        "DELETE FROM anchors WHERE target_id = ?1 AND target_type = 'note'",
        [note_id],
    )?;
    for anchor in anchors {
        if anchor.anchor_uri.trim().is_empty() {
            continue;
        }
        conn.execute(
            "INSERT OR REPLACE INTO anchors
             (id, target_id, target_type, anchor_uri, exact_text,
              start_offset, end_offset, created_at)
             VALUES (?1, ?2, 'note', ?3, ?4, ?5, ?6, ?7)",
            params![
                Uuid::new_v4().to_string(),
                note_id,
                anchor.anchor_uri.trim(),
                anchor.exact_text.trim(),
                anchor.start_offset,
                anchor.end_offset,
                now_epoch()
            ],
        )?;
    }
    Ok(())
}

pub fn create_highlight(
    conn: &Connection,
    anchor_uri: &str,
    exact_text: &str,
    style_id: &str,
    start_offset: i64,
    end_offset: i64,
) -> Result<Highlight> {
    let id = Uuid::new_v4().to_string();
    let now = now_epoch();
    conn.execute(
        "INSERT INTO highlights (id, style_id, created_at) VALUES (?1, ?2, ?3)",
        params![id, style_id, now],
    )?;
    conn.execute(
        "INSERT INTO anchors
         (id, target_id, target_type, anchor_uri, exact_text,
          start_offset, end_offset, created_at)
         VALUES (?1, ?2, 'highlight', ?3, ?4, ?5, ?6, ?7)",
        params![
            Uuid::new_v4().to_string(),
            id,
            anchor_uri.trim(),
            exact_text.trim(),
            start_offset,
            end_offset,
            now
        ],
    )?;
    Ok(Highlight {
        id,
        style_id: style_id.to_string(),
        anchor_uri: anchor_uri.to_string(),
        exact_text: exact_text.to_string(),
        start_offset,
        end_offset,
        created_at: now,
    })
}

pub fn delete_highlight(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM anchors WHERE target_id = ?1 AND target_type = 'highlight'",
        [id],
    )?;
    conn.execute("DELETE FROM highlights WHERE id = ?1", [id])?;
    Ok(())
}

pub fn annotations_for_prefix(conn: &Connection, prefix: &str) -> Result<AnnotationBundle> {
    let mut stmt = conn.prepare(
        "SELECT target_id, target_type FROM anchors WHERE anchor_uri LIKE ?1",
    )?;
    let pattern = format!("{prefix}%");
    let rows = stmt.query_map([&pattern], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut note_ids = HashSet::new();
    let mut highlight_ids = HashSet::new();
    for row in rows {
        let (id, kind) = row?;
        if kind == "note" {
            note_ids.insert(id);
        } else if kind == "highlight" {
            highlight_ids.insert(id);
        }
    }

    let mut notes = Vec::new();
    for id in note_ids {
        if let Some(note) = get_note_summary(conn, &id)? {
            notes.push(note);
        }
    }
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    let mut highlights = Vec::new();
    for id in highlight_ids {
        if let Some(highlight) = conn
            .query_row(
                "SELECT h.id, h.style_id, a.anchor_uri, a.exact_text,
                        a.start_offset, a.end_offset, h.created_at
                 FROM highlights h
                 JOIN anchors a ON a.target_id = h.id AND a.target_type = 'highlight'
                 WHERE h.id = ?1",
                [&id],
                |row| {
                    Ok(Highlight {
                        id: row.get(0)?,
                        style_id: row.get(1)?,
                        anchor_uri: row.get(2)?,
                        exact_text: row.get(3)?,
                        start_offset: row.get(4)?,
                        end_offset: row.get(5)?,
                        created_at: row.get(6)?,
                    })
                },
            )
            .optional()?
        {
            highlights.push(highlight);
        }
    }
    highlights.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(AnnotationBundle { notes, highlights })
}

pub fn export_bundle(conn: &Connection) -> Result<UgcBundle> {
    let notebooks = list_notebooks(conn)?;
    let tags = list_tags(conn)?;
    let note_ids = {
        let mut stmt = conn.prepare("SELECT id FROM notes ORDER BY created_at")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut notes = Vec::new();
    for id in &note_ids {
        if let Some(note) = get_note(conn, id)? {
            notes.push(note);
        }
    }
    let anchors = {
        let mut stmt = conn.prepare(
            "SELECT id, target_id, target_type, anchor_uri, exact_text,
                    start_offset, end_offset, created_at
             FROM anchors ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Anchor {
                id: row.get(0)?,
                target_id: row.get(1)?,
                target_type: row.get(2)?,
                anchor_uri: row.get(3)?,
                exact_text: row.get(4)?,
                start_offset: row.get(5)?,
                end_offset: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let highlights = {
        let mut stmt = conn.prepare(
            "SELECT h.id, h.style_id, a.anchor_uri, a.exact_text,
                    a.start_offset, a.end_offset, h.created_at
             FROM highlights h
             JOIN anchors a ON a.target_id = h.id AND a.target_type = 'highlight'
             ORDER BY h.created_at",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Highlight {
                id: row.get(0)?,
                style_id: row.get(1)?,
                anchor_uri: row.get(2)?,
                exact_text: row.get(3)?,
                start_offset: row.get(4)?,
                end_offset: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let note_tags = {
        let mut stmt = conn.prepare("SELECT note_id, tag_id FROM note_tags")?;
        let rows = stmt.query_map([], |row| {
            Ok(NoteExportTagLink {
                note_id: row.get(0)?,
                tag_id: row.get(1)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    Ok(UgcBundle {
        version: 1,
        exported_at: now_epoch(),
        notebooks,
        notes,
        anchors,
        highlights,
        tags,
        note_tags,
    })
}

pub fn import_bundle(conn: &mut Connection, bundle: &UgcBundle) -> Result<(usize, usize, usize, usize, usize)> {
    let tx = conn.transaction()?;
    for notebook in &bundle.notebooks {
        tx.execute(
            "INSERT OR REPLACE INTO notebooks (id, parent_id, name, color, created_at, updated_at)
             VALUES (?1, NULL, ?2, ?3, ?4, ?5)",
            params![
                notebook.id,
                notebook.name,
                notebook.color,
                notebook.created_at,
                notebook.updated_at
            ],
        )?;
    }
    for notebook in &bundle.notebooks {
        let parent = notebook.parent_id.as_deref().filter(|id| {
            tx.query_row("SELECT 1 FROM notebooks WHERE id = ?1", [id], |_| Ok(()))
                .optional()
                .ok()
                .flatten()
                .is_some()
        });
        tx.execute(
            "UPDATE notebooks SET parent_id = ?2 WHERE id = ?1",
            params![notebook.id, parent],
        )?;
    }
    for tag in &bundle.tags {
        tx.execute(
            "INSERT OR REPLACE INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![tag.id, tag.name, now_epoch()],
        )?;
    }
    for note in &bundle.notes {
        let notebook = note.notebook_id.as_deref().filter(|id| {
            tx.query_row("SELECT 1 FROM notebooks WHERE id = ?1", [id], |_| Ok(()))
                .optional()
                .ok()
                .flatten()
                .is_some()
        });
        tx.execute(
            "INSERT OR REPLACE INTO notes
             (id, notebook_id, title, content_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                note.id,
                notebook,
                note.title,
                serde_json::to_string(&note.content_json)?,
                note.created_at,
                note.updated_at
            ],
        )?;
        tx.execute("DELETE FROM note_tags WHERE note_id = ?1", [&note.id])?;
        tx.execute(
            "DELETE FROM anchors WHERE target_id = ?1 AND target_type = 'note'",
            [&note.id],
        )?;
    }
    for highlight in &bundle.highlights {
        tx.execute(
            "INSERT OR REPLACE INTO highlights (id, style_id, created_at)
             VALUES (?1, ?2, ?3)",
            params![highlight.id, highlight.style_id, highlight.created_at],
        )?;
        tx.execute(
            "DELETE FROM anchors WHERE target_id = ?1 AND target_type = 'highlight'",
            [&highlight.id],
        )?;
    }
    for anchor in &bundle.anchors {
        tx.execute(
            "INSERT OR REPLACE INTO anchors
             (id, target_id, target_type, anchor_uri, exact_text,
              start_offset, end_offset, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                anchor.id,
                anchor.target_id,
                anchor.target_type,
                anchor.anchor_uri,
                anchor.exact_text,
                anchor.start_offset,
                anchor.end_offset,
                anchor.created_at
            ],
        )?;
    }
    for link in &bundle.note_tags {
        tx.execute(
            "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
            params![link.note_id, link.tag_id],
        )?;
    }
    tx.commit()?;
    Ok((
        bundle.notebooks.len(),
        bundle.notes.len(),
        bundle.anchors.len(),
        bundle.highlights.len(),
        bundle.tags.len(),
    ))
}

fn get_note_summary(conn: &Connection, id: &str) -> Result<Option<NoteSummary>> {
    let note = get_note(conn, id)?;
    Ok(note.map(|note| NoteSummary {
        id: note.id,
        notebook_id: note.notebook_id,
        title: note.title,
        excerpt: excerpt(&serde_json::to_string(&note.content_json).unwrap_or_default()),
        created_at: note.created_at,
        updated_at: note.updated_at,
        origin_uuid: note.origin_uuid,
        author_name: note.author_name,
        sort_order: note.sort_order,
        tags: note.tags,
        anchors: note.anchors,
    }))
}

fn note_tags(conn: &Connection, note_id: &str) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, 0 FROM tags t
         JOIN note_tags nt ON nt.tag_id = t.id
         WHERE nt.note_id = ?1 ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([note_id], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            count: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn note_anchors(conn: &Connection, note_id: &str) -> Result<Vec<Anchor>> {
    let mut stmt = conn.prepare(
        "SELECT id, target_id, target_type, anchor_uri, exact_text,
                start_offset, end_offset, created_at
         FROM anchors WHERE target_id = ?1 AND target_type = 'note'
         ORDER BY created_at",
    )?;
    let rows = stmt.query_map([note_id], |row| {
        Ok(Anchor {
            id: row.get(0)?,
            target_id: row.get(1)?,
            target_type: row.get(2)?,
            anchor_uri: row.get(3)?,
            exact_text: row.get(4)?,
            start_offset: row.get(5)?,
            end_offset: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn excerpt(content_json: &str) -> String {
    let value = serde_json::from_str::<Value>(content_json).unwrap_or(Value::Null);
    let mut text = String::new();
    collect_text(&value, &mut text);
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() > 180 {
        format!("{}…", text.chars().take(180).collect::<String>())
    } else {
        text
    }
}

fn collect_text(value: &Value, output: &mut String) {
    match value {
        Value::Object(map) => {
            if let Some(Value::String(text)) = map.get("text") {
                output.push_str(text);
                output.push(' ');
            }
            if let Some(content) = map.get("content") {
                collect_text(content, output);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_text(item, output);
            }
        }
        Value::String(text) => output.push_str(text),
        _ => {}
    }
}

pub fn create_notebook_node(
    conn: &Connection,
    name: &str,
    parent_id: Option<String>,
    node_type: &str,
    color: &str,
    icon: &str,
) -> Result<Notebook> {
    let id = Uuid::new_v4().to_string();
    let now = now_epoch();
    let parent = parent_id.filter(|value| !value.trim().is_empty());
    conn.execute(
        "INSERT INTO notebooks
            (id, parent_id, name, color, created_at, updated_at, node_type, icon, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
        params![
            id,
            parent,
            name.trim(),
            if color.trim().is_empty() { "#38bdf8" } else { color },
            now,
            now,
            if node_type == "folder" { "folder" } else { "notebook" },
            icon.trim()
        ],
    )?;
    get_notebook(conn, &id)?.context("no se pudo crear la carpeta")
}
