use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::now_epoch;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningSession {
    pub id: String,
    pub goal_title: String,
    pub topic_category: String,
    pub stage: String,
    pub dependency_plan: Value,
    pub messages: Value,
    pub active_step_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeProposition {
    pub id: String,
    pub session_id: String,
    pub claim: String,
    pub reasoning_premise: String,
    pub related_refs: Value,
    pub related_strongs: Value,
    pub mastery_state: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningSessionInput {
    pub id: Option<String>,
    pub goal_title: String,
    #[serde(default = "default_category")]
    pub topic_category: String,
    #[serde(default = "default_stage")]
    pub stage: String,
    #[serde(default)]
    pub dependency_plan: Value,
    #[serde(default)]
    pub messages: Value,
    #[serde(default)]
    pub active_step_id: String,
}

fn default_category() -> String { "exegesis".into() }
fn default_stage() -> String { "measure".into() }

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<LearningSession> {
    let plan: String = row.get(4)?;
    let messages: String = row.get(5)?;
    Ok(LearningSession {
        id: row.get(0)?, goal_title: row.get(1)?, topic_category: row.get(2)?,
        stage: row.get(3)?, dependency_plan: serde_json::from_str(&plan).unwrap_or(Value::Array(vec![])),
        messages: serde_json::from_str(&messages).unwrap_or(Value::Array(vec![])),
        active_step_id: row.get(6)?, created_at: row.get(7)?, updated_at: row.get(8)?,
    })
}

pub fn session_list(conn: &Connection) -> Result<Vec<LearningSession>> {
    let mut stmt = conn.prepare(
        "SELECT id,goal_title,topic_category,stage,dependency_plan_json,messages_json,active_step_id,created_at,updated_at
         FROM learning_sessions ORDER BY updated_at DESC",
    )?;
    Ok(stmt.query_map([], row_to_session)?.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn session_get(conn: &Connection, id: &str) -> Result<Option<LearningSession>> {
    Ok(conn.query_row(
        "SELECT id,goal_title,topic_category,stage,dependency_plan_json,messages_json,active_step_id,created_at,updated_at
         FROM learning_sessions WHERE id=?1",
        [id], row_to_session,
    ).optional()?)
}

pub fn session_save(conn: &Connection, input: LearningSessionInput) -> Result<LearningSession> {
    let id = input.id.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = now_epoch();
    conn.execute(
        "INSERT INTO learning_sessions(id,goal_title,topic_category,stage,dependency_plan_json,messages_json,active_step_id,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)
         ON CONFLICT(id) DO UPDATE SET goal_title=excluded.goal_title, topic_category=excluded.topic_category,
           stage=excluded.stage, dependency_plan_json=excluded.dependency_plan_json,
           messages_json=excluded.messages_json, active_step_id=excluded.active_step_id, updated_at=excluded.updated_at",
        params![id, input.goal_title, input.topic_category, input.stage,
            serde_json::to_string(&input.dependency_plan)?, serde_json::to_string(&input.messages)?,
            input.active_step_id, now],
    )?;
    session_get(conn, &id)?.context("no se pudo leer la sesión")
}

pub fn session_delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM knowledge_propositions WHERE session_id=?1", [id])?;
    conn.execute("DELETE FROM learning_sessions WHERE id=?1", [id])?;
    Ok(())
}

pub fn proposition_add(conn: &Connection, session_id: &str, claim: &str, premise: &str, refs: Value, strongs: Value) -> Result<KnowledgeProposition> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_epoch();
    conn.execute(
        "INSERT INTO knowledge_propositions(id,session_id,claim,reasoning_premise,related_refs_json,related_strongs_json,mastery_state,created_at)
         VALUES(?1,?2,?3,?4,?5,?6,'learned',?7)",
        params![id, session_id, claim, premise, serde_json::to_string(&refs)?, serde_json::to_string(&strongs)?, now],
    )?;
    graph_get(conn, &id)?.context("no se pudo leer la proposición")
}

fn row_to_prop(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeProposition> {
    let refs: String = row.get(4)?; let strongs: String = row.get(5)?;
    Ok(KnowledgeProposition {
        id: row.get(0)?, session_id: row.get(1)?, claim: row.get(2)?,
        reasoning_premise: row.get(3)?, related_refs: serde_json::from_str(&refs).unwrap_or(Value::Array(vec![])),
        related_strongs: serde_json::from_str(&strongs).unwrap_or(Value::Array(vec![])),
        mastery_state: row.get(6)?, created_at: row.get(7)?,
    })
}

fn graph_get(conn: &Connection, id: &str) -> Result<Option<KnowledgeProposition>> {
    Ok(conn.query_row(
        "SELECT id,session_id,claim,reasoning_premise,related_refs_json,related_strongs_json,mastery_state,created_at
         FROM knowledge_propositions WHERE id=?1", [id], row_to_prop).optional()?)
}

pub fn graph_list(conn: &Connection, session_id: Option<&str>) -> Result<Vec<KnowledgeProposition>> {
    let (sql, values): (&str, Vec<&str>) = match session_id {
        Some(id) => ("SELECT id,session_id,claim,reasoning_premise,related_refs_json,related_strongs_json,mastery_state,created_at FROM knowledge_propositions WHERE session_id=?1 ORDER BY created_at DESC", vec![id]),
        None => ("SELECT id,session_id,claim,reasoning_premise,related_refs_json,related_strongs_json,mastery_state,created_at FROM knowledge_propositions ORDER BY created_at DESC", vec![]),
    };
    let mut stmt = conn.prepare(sql)?;
    Ok(stmt.query_map(rusqlite::params_from_iter(values), row_to_prop)?.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn proposition_delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM knowledge_edges WHERE from_prop_id=?1 OR to_prop_id=?1", [id])?;
    conn.execute("DELETE FROM knowledge_propositions WHERE id=?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Catalog;
    #[test]
    fn learning_session_and_graph_cycle() {
        let catalog = Catalog::open_in_memory().unwrap();
        let conn = catalog.connection();
        let session = session_save(conn, LearningSessionInput {
            id: None, goal_title: "Probar exégesis".into(), topic_category: "exegesis".into(),
            stage: "measure".into(), dependency_plan: serde_json::json!([]), messages: serde_json::json!([]), active_step_id: "".into(),
        }).unwrap();
        assert!(session_get(conn, &session.id).unwrap().is_some());
        let prop = proposition_add(conn, &session.id, "Dios crea", "Gn 1:1", serde_json::json!(["Gn 1:1"]), serde_json::json!(["H430"])).unwrap();
        assert_eq!(graph_list(conn, Some(&session.id)).unwrap().len(), 1);
        proposition_delete(conn, &prop.id).unwrap();
        session_delete(conn, &session.id).unwrap();
        assert!(session_get(conn, &session.id).unwrap().is_none());
    }
}
