use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::Value;
use uuid::Uuid;

use crate::db::now_epoch;
use crate::model::{empty_array, empty_document, Sermon, SermonInput};

const SERMON_COLUMNS: &str = "id, title, series, series_number, topics, passages, tags,
    speaker, venue, service, date_time, audience, description, content_json,
    questions_json, slide_settings_json, created_at, updated_at";

pub fn list_sermons(connection: &Connection) -> Result<Vec<Sermon>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {SERMON_COLUMNS} FROM sermons
         ORDER BY CASE WHEN date_time = '' THEN 1 ELSE 0 END,
                  date_time DESC, updated_at DESC, title COLLATE NOCASE"
    ))?;
    let rows = statement.query_map([], row_to_sermon)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_sermon(connection: &Connection, id: &str) -> Result<Option<Sermon>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {SERMON_COLUMNS} FROM sermons WHERE id = ?1"
    ))?;
    let sermon = statement.query_row([id], row_to_sermon).optional()?;
    Ok(sermon)
}

pub fn create_sermon(connection: &Connection, input: SermonInput) -> Result<Sermon> {
    let id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = now_epoch();
    connection.execute(
        "INSERT INTO sermons
            (id, title, series, series_number, topics, passages, tags, speaker, venue,
             service, date_time, audience, description, content_json, questions_json,
             slide_settings_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            id,
            input.title.trim(),
            input.series.trim(),
            input.series_number,
            encode_list(&input.topics),
            encode_list(&input.passages),
            encode_list(&input.tags),
            input.speaker.trim(),
            input.venue.trim(),
            input.service.trim(),
            input.date_time.trim(),
            input.audience.trim(),
            input.description,
            encode_value(&input.content_json),
            encode_value(&input.questions_json),
            encode_value(&input.slide_settings),
            now,
            now,
        ],
    )?;
    crate::indexer_v2::sync_sermon_fts(connection, &id)?;
    get_sermon(connection, &id)?.context("no se pudo crear el sermón")
}

pub fn update_sermon(connection: &Connection, id: &str, input: SermonInput) -> Result<Sermon> {
    let changed = connection.execute(
        "UPDATE sermons SET
            title = ?2,
            series = ?3,
            series_number = ?4,
            topics = ?5,
            passages = ?6,
            tags = ?7,
            speaker = ?8,
            venue = ?9,
            service = ?10,
            date_time = ?11,
            audience = ?12,
            description = ?13,
            content_json = ?14,
            questions_json = ?15,
            slide_settings_json = ?16,
            updated_at = ?17
         WHERE id = ?1",
        params![
            id,
            input.title.trim(),
            input.series.trim(),
            input.series_number,
            encode_list(&input.topics),
            encode_list(&input.passages),
            encode_list(&input.tags),
            input.speaker.trim(),
            input.venue.trim(),
            input.service.trim(),
            input.date_time.trim(),
            input.audience.trim(),
            input.description,
            encode_value(&input.content_json),
            encode_value(&input.questions_json),
            encode_value(&input.slide_settings),
            now_epoch(),
        ],
    )?;
    if changed == 0 {
        return Err(anyhow::anyhow!("No existe el sermón {id}"));
    }
    crate::indexer_v2::sync_sermon_fts(connection, id)?;
    get_sermon(connection, id)?.context("no se pudo leer el sermón actualizado")
}

pub fn delete_sermon(connection: &Connection, id: &str) -> Result<()> {
    connection.execute("DELETE FROM sermons WHERE id = ?1", [id])?;
    connection.execute("DELETE FROM sermons_fts WHERE sermon_id = ?1", [id])?;
    Ok(())
}

fn row_to_sermon(row: &Row<'_>) -> rusqlite::Result<Sermon> {
    let topics: String = row.get(4)?;
    let passages: String = row.get(5)?;
    let tags: String = row.get(6)?;
    let content_json: String = row.get(13)?;
    let questions_json: String = row.get(14)?;
    let slide_settings_json: String = row.get(15)?;
    Ok(Sermon {
        id: row.get(0)?,
        title: row.get(1)?,
        series: row.get(2)?,
        series_number: row.get(3)?,
        topics: decode_list(&topics),
        passages: decode_list(&passages),
        tags: decode_list(&tags),
        speaker: row.get(7)?,
        venue: row.get(8)?,
        service: row.get(9)?,
        date_time: row.get(10)?,
        audience: row.get(11)?,
        description: row.get(12)?,
        content_json: decode_value(&content_json, empty_document()),
        questions_json: decode_value(&questions_json, empty_array()),
        slide_settings: decode_value(&slide_settings_json, crate::model::empty_object()),
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

fn encode_list(value: &[String]) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "[]".to_string())
}

fn encode_value(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

fn decode_list(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_else(|_| {
        raw.split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect()
    })
}

fn decode_value(raw: &str, fallback: Value) -> Value {
    serde_json::from_str(raw).unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Catalog;
    use crate::model::{empty_array, empty_document};

    fn sample_input() -> SermonInput {
        SermonInput {
            id: None,
            title: "El poder de la gracia".to_string(),
            series: "Reflexiones".to_string(),
            series_number: Some(2),
            topics: vec!["Gracia".to_string()],
            passages: vec!["Efesios 2:8-9".to_string()],
            tags: vec!["Gracia".to_string()],
            speaker: "Raúl".to_string(),
            venue: "CBJN".to_string(),
            service: "18:00".to_string(),
            date_time: "2026-11-08T18:00".to_string(),
            audience: "Adultos".to_string(),
            description: "Prueba".to_string(),
            content_json: empty_document(),
            questions_json: empty_array(),
            slide_settings: crate::model::empty_object(),
        }
    }

    #[test]
    fn sermon_crud_round_trip() {
        let catalog = Catalog::open_in_memory().unwrap();
        let connection = catalog.connection();
        let created = create_sermon(connection, sample_input()).unwrap();
        assert_eq!(created.title, "El poder de la gracia");
        assert_eq!(created.series_number, Some(2));
        assert_eq!(created.topics, vec!["Gracia".to_string()]);

        let mut updated_input = sample_input();
        updated_input.title = "Gracia que transforma".to_string();
        updated_input.topics = vec!["Gracia".to_string(), "Fe".to_string()];
        updated_input.slide_settings = serde_json::json!({
            "backgrounds": { "slide-title": "#101722" },
            "order": ["slide-title"]
        });
        let updated = update_sermon(connection, &created.id, updated_input).unwrap();
        assert_eq!(updated.title, "Gracia que transforma");
        assert_eq!(updated.topics.len(), 2);
        assert_eq!(
            updated.slide_settings["backgrounds"]["slide-title"],
            "#101722"
        );

        let listed = list_sermons(connection).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);

        delete_sermon(connection, &created.id).unwrap();
        assert!(get_sermon(connection, &created.id).unwrap().is_none());
    }

    #[test]
    fn sermon_input_accepts_camel_case_json() {
        let input: SermonInput = serde_json::from_str(
            r#"{
                "title": "Prueba",
                "contentJson": {"type":"doc","content":[{"type":"paragraph"}]},
                "questionsJson": [],
                "seriesNumber": 4
            }"#,
        )
        .unwrap();
        assert_eq!(input.title, "Prueba");
        assert_eq!(input.series_number, Some(4));
        assert_eq!(input.content_json["type"], "doc");
    }
}
