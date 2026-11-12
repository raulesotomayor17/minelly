use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Manager, State};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::books::{all_books, book_info};
use crate::db::Catalog;
use crate::import::{import_path, scan_folder};
use crate::model::{
    AnnotationBundle, BookInfo, BookText, CommentaryEntry, DictionaryEntry, EpubChapter,
    EpubChapterSummary, Highlight, ImportReport, Note, NoteFilter, NoteInput, NoteSummary,
    Notebook, NotesExportResult, NotesImportResult, Passage, PbbBook, PbbBuildRequest,
    PbbBuildResult, PixabayImage, PixabaySearchResult, RagAnswer, Resource, SearchHit, Sermon,
    SermonInput, Tag, UgcBundle, GlobalIndexStatus, GlobalSearchHit, IndexReport,
    UnifiedSearchResult, InterlinearImportReport, InterlinearStatus, InterlinearVerse,
    DocumentBlock, SlideExport, StrongEntry, TtsAudio, TtsHealth, TtsVoice,
    TtsVoiceList, WordOccurrence, WordStudyResult, PassageRangeHit,
};

pub struct AppState {
    pub catalog: Mutex<Catalog>,
}

fn message(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}

#[tauri::command]
pub fn list_resources(state: State<'_, AppState>) -> Result<Vec<Resource>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    catalog.list_resources().map_err(message)
}

#[tauri::command]
pub fn books() -> Vec<BookInfo> {
    all_books()
}

#[tauri::command]
pub fn get_passage(
    state: State<'_, AppState>,
    resource_id: String,
    book: i64,
    chapter: i64,
) -> Result<Passage, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    let resource = catalog
        .get_resource(&resource_id)
        .map_err(message)?
        .ok_or_else(|| format!("No existe el recurso {resource_id}"))?;
    let verses = catalog
        .get_verses(&resource_id, book, chapter)
        .map_err(message)?;
    Ok(Passage {
        resource,
        book: book_info(book),
        chapter,
        verses,
    })
}

#[tauri::command]
pub fn get_book_text(
    state: State<'_, AppState>,
    resource_id: String,
    book: i64,
) -> Result<BookText, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    let resource = catalog
        .get_resource(&resource_id)
        .map_err(message)?
        .ok_or_else(|| format!("No existe el recurso {resource_id}"))?;
    let verses = catalog
        .get_book_verses(&resource_id, book)
        .map_err(message)?;
    Ok(BookText {
        resource,
        book: book_info(book),
        verses,
    })
}

#[tauri::command]
pub fn get_commentaries(
    state: State<'_, AppState>,
    resource_id: String,
    book: i64,
    chapter: i64,
    verse: i64,
) -> Result<Vec<CommentaryEntry>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    catalog
        .get_commentaries(&resource_id, book, chapter, verse)
        .map_err(message)
}

#[tauri::command]
pub fn epub_chapters(
    state: State<'_, AppState>,
    resource_id: String,
) -> Result<Vec<EpubChapterSummary>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    catalog.epub_chapters(&resource_id).map_err(message)
}

#[tauri::command]
pub fn get_epub_chapter(
    state: State<'_, AppState>,
    resource_id: String,
    spine: i64,
) -> Result<Option<EpubChapter>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    catalog
        .get_epub_chapter(&resource_id, spine)
        .map_err(message)
}

#[tauri::command]
pub fn dictionary_topics(
    state: State<'_, AppState>,
    resource_id: String,
    limit: Option<i64>,
) -> Result<Vec<String>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    catalog
        .dictionary_topics(&resource_id, limit.unwrap_or(200))
        .map_err(message)
}

#[tauri::command]
pub fn lookup_dictionary(
    state: State<'_, AppState>,
    resource_id: String,
    topic: String,
) -> Result<Option<DictionaryEntry>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    catalog
        .lookup_dictionary(&resource_id, &topic)
        .map_err(message)
}

#[tauri::command]
pub fn search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    catalog.search(&query, limit.unwrap_or(50)).map_err(message)
}

#[tauri::command]
pub fn import_folder(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<ImportReport>, String> {
    let folder = PathBuf::from(&path);
    if !folder.exists() {
        return Err(format!("No existe la carpeta {path}"));
    }
    let files = if folder.is_dir() {
        scan_folder(&folder)
    } else {
        vec![folder]
    };
    if files.is_empty() {
        return Err(format!("No se encontraron módulos en {path}"));
    }
    let mut catalog = state.catalog.lock().map_err(message)?;
    let mut reports = Vec::new();
    for file in files {
        match import_path(&mut catalog, &file) {
            Ok(mut report) => {
                if let Err(error) =
                    crate::indexer::index_resource(catalog.connection_mut(), &report.resource.id)
                {
                    report
                        .warnings
                        .push(format!("No se pudo indexar para búsqueda global: {error:#}"));
                }
                reports.push(report);
            }
            Err(error) => {
                eprintln!("No se pudo importar {}: {error:#}", file.display());
            }
        }
    }
    Ok(reports)
}

#[tauri::command]
pub fn pbb_build(
    app: AppHandle,
    state: State<'_, AppState>,
    request: PbbBuildRequest,
) -> Result<PbbBuildResult, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| message(error.to_string()))?;
    let mut catalog = state.catalog.lock().map_err(message)?;
    let result = crate::pbb::build(&mut catalog, &request, &data_dir).map_err(message)?;
    if result.status == "success" {
        let _ = crate::indexer::index_resource(catalog.connection_mut(), &result.resource_id);
    }
    Ok(result)
}

#[tauri::command]
pub fn pbb_recompile(
    app: AppHandle,
    state: State<'_, AppState>,
    resource_id: String,
) -> Result<PbbBuildResult, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| message(error.to_string()))?;
    let mut catalog = state.catalog.lock().map_err(message)?;
    let result = crate::pbb::recompile(&mut catalog, &resource_id, &data_dir).map_err(message)?;
    if result.status == "success" {
        let _ = crate::indexer::index_resource(catalog.connection_mut(), &result.resource_id);
    }
    Ok(result)
}

#[tauri::command]
pub fn pbb_list(state: State<'_, AppState>) -> Result<Vec<PbbBook>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    catalog.pbb_books().map_err(message)
}

#[tauri::command]
pub fn pbb_delete(state: State<'_, AppState>, resource_id: String) -> Result<(), String> {
    let mut catalog = state.catalog.lock().map_err(message)?;
    if let Some(book) = catalog.pbb_book(&resource_id).map_err(message)? {
        if book.cloud_synced {
            return Err(
                "El libro está marcado como sincronizado y es inmutable. Puedes ocultarlo, pero no eliminarlo."
                    .to_string(),
            );
        }
    }
    catalog.delete_resource(&resource_id).map_err(message)
}

#[tauri::command]
pub fn update_resource_metadata(
    state: State<'_, AppState>,
    resource_id: String,
    metadata: serde_json::Value,
) -> Result<(), String> {
    let mut catalog = state.catalog.lock().map_err(message)?;
    let encoded = serde_json::to_string(&metadata).map_err(message)?;
    catalog
        .update_resource_metadata(&resource_id, &encoded)
        .map_err(message)
}

#[tauri::command]
pub fn delete_resource(state: State<'_, AppState>, resource_id: String) -> Result<(), String> {
    let mut catalog = state.catalog.lock().map_err(message)?;
    if let Some(book) = catalog.pbb_book(&resource_id).map_err(message)? {
        if book.cloud_synced {
            return Err(
                "El libro está marcado como sincronizado y es inmutable. Puedes ocultarlo, pero no eliminarlo."
                    .to_string(),
            );
        }
    }
    catalog.delete_resource(&resource_id).map_err(message)
}

#[tauri::command]
pub fn pbb_set_synced(
    app: AppHandle,
    state: State<'_, AppState>,
    resource_id: String,
    synced: bool,
) -> Result<String, String> {
    if !synced {
        return Err(
            "Un libro sincronizado es inmutable; no se puede desbloquear desde la biblioteca."
                .to_string(),
        );
    }
    let mut catalog = state.catalog.lock().map_err(message)?;
    let book = catalog
        .pbb_book(&resource_id)
        .map_err(message)?
        .ok_or_else(|| format!("No existe el libro personal {resource_id}"))?;
    let chapter_summaries = catalog
        .epub_chapters(&resource_id)
        .map_err(message)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| message(error.to_string()))?;
    let sync_dir = data_dir.join("sync");
    std::fs::create_dir_all(&sync_dir).map_err(message)?;
    let bundle_path = sync_dir.join(format!(
        "{}.pbbundle.json",
        resource_id
            .replace(':', "-")
            .replace('\\', "-")
            .replace('/', "-")
            .replace(' ', "-")
    ));
    let mut chapter_values = Vec::new();
    for summary in chapter_summaries {
        if let Some(chapter) = catalog
            .get_epub_chapter(&resource_id, summary.spine)
            .map_err(message)?
        {
            chapter_values.push(serde_json::json!({
                "spine": chapter.spine,
                "title": chapter.title,
                "href": chapter.href,
                "html": chapter.html,
            }));
        }
    }
    let bundle = serde_json::json!({
        "version": 1,
        "book": book,
        "chapters": chapter_values,
        "note": "Paquete local de sincronización; no se ha subido a un servicio en la nube."
    });
    std::fs::write(
        &bundle_path,
        serde_json::to_vec_pretty(&bundle).map_err(message)?,
    )
    .map_err(message)?;
    catalog
        .set_pbb_cloud_synced(&resource_id, true)
        .map_err(message)?;
    Ok(bundle_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn pbb_set_hidden(
    state: State<'_, AppState>,
    resource_id: String,
    hidden: bool,
) -> Result<(), String> {
    let mut catalog = state.catalog.lock().map_err(message)?;
    catalog
        .set_pbb_hidden(&resource_id, hidden)
        .map_err(message)
}

#[tauri::command]
pub fn pbb_read_log(app: AppHandle, path: String) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| message(error.to_string()))?;
    let logs = data_dir.join("logs");
    let requested = std::path::PathBuf::from(&path);
    let canonical = std::fs::canonicalize(&requested)
        .map_err(|error| format!("No se pudo leer el registro: {error}"))?;
    let canonical_logs = std::fs::canonicalize(&logs).unwrap_or(logs);
    if !canonical.starts_with(&canonical_logs) {
        return Err("El registro solicitado no está en la carpeta de diagnóstico.".to_string());
    }
    std::fs::read_to_string(&canonical)
        .map_err(|error| format!("No se pudo leer el registro: {error}"))
}

#[tauri::command]
pub fn pbb_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let catalog = state.catalog.lock().map_err(message)?;
    catalog
        .pbb_search_fts(query.trim(), limit.unwrap_or(30))
        .map_err(message)
}

#[tauri::command]
pub fn notebooks_list(state: State<'_, AppState>) -> Result<Vec<Notebook>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::list_notebooks(catalog.connection()).map_err(message)
}

#[tauri::command]
pub fn notebook_create(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<String>,
    color: Option<String>,
) -> Result<Notebook, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::create_notebook(catalog.connection(), &name, parent_id, color).map_err(message)
}

#[tauri::command]
pub fn notebook_update(
    state: State<'_, AppState>,
    id: String,
    name: String,
    parent_id: Option<String>,
    color: Option<String>,
) -> Result<Notebook, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::update_notebook(catalog.connection(), &id, &name, parent_id, color)
        .map_err(message)
}

#[tauri::command]
pub fn notebook_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::delete_notebook(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub fn tags_list(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::list_tags(catalog.connection()).map_err(message)
}

#[tauri::command]
pub fn tag_create(state: State<'_, AppState>, name: String) -> Result<Tag, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::create_tag(catalog.connection(), &name).map_err(message)
}

#[tauri::command]
pub fn tag_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::delete_tag(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub fn notes_list(
    state: State<'_, AppState>,
    filter: NoteFilter,
) -> Result<Vec<NoteSummary>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::list_notes(catalog.connection(), &filter).map_err(message)
}

#[tauri::command]
pub fn note_get(state: State<'_, AppState>, id: String) -> Result<Option<Note>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::get_note(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub fn note_create(
    state: State<'_, AppState>,
    input: NoteInput,
) -> Result<Note, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::create_note(catalog.connection(), &input).map_err(message)
}

#[tauri::command]
pub fn note_update(
    state: State<'_, AppState>,
    id: String,
    input: NoteInput,
) -> Result<Note, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::update_note(catalog.connection(), &id, &input).map_err(message)
}

#[tauri::command]
pub fn notebook_create_node(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<String>,
    node_type: Option<String>,
    color: Option<String>,
    icon: Option<String>,
) -> Result<crate::model::Notebook, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::create_notebook_node(
        catalog.connection(),
        &name,
        parent_id,
        node_type.as_deref().unwrap_or("notebook"),
        color.as_deref().unwrap_or("#38bdf8"),
        icon.as_deref().unwrap_or(""),
    )
    .map_err(message)
}

#[tauri::command]
pub fn notebook_move(
    state: State<'_, AppState>,
    id: String,
    parent_id: Option<String>,
    sort_order: Option<i64>,
) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::move_notebook(
        catalog.connection(),
        &id,
        parent_id.as_deref().filter(|value| !value.is_empty()),
        sort_order.unwrap_or(0),
    )
    .map_err(message)
}

#[tauri::command]
pub fn note_move(
    state: State<'_, AppState>,
    id: String,
    notebook_id: Option<String>,
    sort_order: Option<i64>,
) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::move_note(
        catalog.connection(),
        &id,
        notebook_id.as_deref().filter(|value| !value.is_empty()),
        sort_order.unwrap_or(0),
    )
    .map_err(message)
}

#[tauri::command]
pub fn note_backlinks(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<crate::model::NoteSummary>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::note_backlinks(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub fn note_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::delete_note(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub fn highlight_create(
    state: State<'_, AppState>,
    anchor_uri: String,
    exact_text: String,
    style_id: String,
    start_offset: Option<i64>,
    end_offset: Option<i64>,
) -> Result<Highlight, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::create_highlight(
        catalog.connection(),
        &anchor_uri,
        &exact_text,
        &style_id,
        start_offset.unwrap_or(0),
        end_offset.unwrap_or(0),
    )
    .map_err(message)
}

#[tauri::command]
pub fn highlight_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::delete_highlight(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub fn annotations_for_prefix(
    state: State<'_, AppState>,
    prefix: String,
) -> Result<AnnotationBundle, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::notes::annotations_for_prefix(catalog.connection(), &prefix).map_err(message)
}

#[tauri::command]
pub fn update_book_chapter_html(
    state: State<'_, AppState>,
    resource_id: String,
    spine: i64,
    html: String,
) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    catalog
        .connection()
        .execute(
            "UPDATE epub_chapters SET html = ?1 WHERE resource_id = ?2 AND spine = ?3",
            rusqlite::params![html, resource_id, spine],
        )
        .map_err(message)?;
    Ok(())
}

#[tauri::command]
pub fn repair_all_books_typesetting(state: State<'_, AppState>) -> Result<usize, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::editorial::repair_all_books(catalog.connection()).map_err(message)
}

#[tauri::command]
pub fn repair_book_typesetting(state: State<'_, AppState>, resource_id: String) -> Result<usize, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    let rows = {
        let mut stmt = catalog.connection().prepare("SELECT rowid, html FROM epub_chapters WHERE resource_id = ?1").map_err(message)?;
        let rows = stmt.query_map([resource_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))).map_err(message)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(message)?
    };
    let mut count = 0;
    for (rowid, html) in rows {
        let normalized = crate::editorial::normalize_editorial_html(&html);
        if normalized != html {
            catalog.connection().execute("UPDATE epub_chapters SET html = ?1 WHERE rowid = ?2", rusqlite::params![normalized, rowid]).map_err(message)?;
            count += 1;
        }
    }
    Ok(count)
}

#[tauri::command]
pub fn learning_session_list(state: State<'_, AppState>) -> Result<Vec<crate::learning::LearningSession>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::learning::session_list(catalog.connection()).map_err(message)
}

#[tauri::command]
pub fn learning_session_get(state: State<'_, AppState>, id: String) -> Result<Option<crate::learning::LearningSession>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::learning::session_get(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub fn learning_session_save(state: State<'_, AppState>, input: crate::learning::LearningSessionInput) -> Result<crate::learning::LearningSession, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::learning::session_save(catalog.connection(), input).map_err(message)
}

#[tauri::command]
pub fn learning_session_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::learning::session_delete(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub fn knowledge_proposition_add(
    state: State<'_, AppState>, session_id: String, claim: String,
    reasoning_premise: Option<String>, related_refs: Option<serde_json::Value>,
    related_strongs: Option<serde_json::Value>,
) -> Result<crate::learning::KnowledgeProposition, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::learning::proposition_add(catalog.connection(), &session_id, &claim,
        reasoning_premise.as_deref().unwrap_or(""), related_refs.unwrap_or(serde_json::json!([])),
        related_strongs.unwrap_or(serde_json::json!([]))).map_err(message)
}

#[tauri::command]
pub fn knowledge_graph_list(state: State<'_, AppState>, session_id: Option<String>) -> Result<Vec<crate::learning::KnowledgeProposition>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::learning::graph_list(catalog.connection(), session_id.as_deref().filter(|v| !v.is_empty())).map_err(message)
}

#[tauri::command]
pub fn knowledge_proposition_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::learning::proposition_delete(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub fn reading_progress_get(state: State<'_, AppState>, resource_id: String) -> Result<Option<crate::model::ReadingProgress>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::reading::progress_get(catalog.connection(), &resource_id).map_err(message)
}

#[tauri::command]
pub fn reading_progress_list(state: State<'_, AppState>) -> Result<Vec<crate::model::ReadingProgress>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::reading::progress_list(catalog.connection()).map_err(message)
}

#[tauri::command]
pub fn reading_progress_save(
    state: State<'_, AppState>, resource_id: String, spine: i64,
    paragraph_index: i64, scroll_ratio: f64,
) -> Result<crate::model::ReadingProgress, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::reading::progress_save(catalog.connection(), &resource_id, spine, paragraph_index, scroll_ratio).map_err(message)
}

#[tauri::command]
pub fn toggle_chapter_completed(
    state: State<'_, AppState>, resource_id: String, spine: i64, completed: bool,
) -> Result<crate::model::ReadingProgress, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::reading::toggle_completed(catalog.connection(), &resource_id, spine, completed).map_err(message)
}

#[tauri::command]
pub fn toggle_reading_unit_completed(
    state: State<'_, AppState>, resource_id: String, spine: i64, completed: bool,
) -> Result<crate::model::ReadingProgress, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::reading::toggle_completed(catalog.connection(), &resource_id, spine, completed).map_err(message)
}

#[tauri::command]
pub fn bookmark_set_ribbon(
    state: State<'_, AppState>, resource_id: String, spine: i64,
    paragraph_index: i64, scroll_ratio: f64, label: Option<String>, note: Option<String>, excerpt: Option<String>, color: Option<String>,
) -> Result<crate::model::BookBookmark, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::reading::bookmark_add(catalog.connection(), &resource_id, spine, paragraph_index, scroll_ratio,
        label.as_deref().unwrap_or("Separador de lectura"), note.as_deref().unwrap_or(""), excerpt.as_deref().unwrap_or(""), true, None, None, None, excerpt.as_deref().unwrap_or(""), color.as_deref().unwrap_or("#d97706")).map_err(message)
}

#[tauri::command]
pub fn bookmark_add(
    state: State<'_, AppState>, resource_id: String, spine: i64,
    paragraph_index: i64, scroll_ratio: f64, label: Option<String>, note: Option<String>, excerpt: Option<String>, color: Option<String>,
) -> Result<crate::model::BookBookmark, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::reading::bookmark_add(catalog.connection(), &resource_id, spine, paragraph_index, scroll_ratio,
        label.as_deref().unwrap_or("Marcador"), note.as_deref().unwrap_or(""), excerpt.as_deref().unwrap_or(""), false, None, None, None, excerpt.as_deref().unwrap_or(""), color.as_deref().unwrap_or("#d97706")).map_err(message)
}

#[tauri::command]
pub fn bookmark_list(state: State<'_, AppState>, resource_id: String) -> Result<Vec<crate::model::BookBookmark>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::reading::bookmark_list(catalog.connection(), &resource_id).map_err(message)
}

#[tauri::command]
pub fn bookmark_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::reading::bookmark_delete(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub fn export_notes(
    state: State<'_, AppState>,
    path: String,
) -> Result<NotesExportResult, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    let bundle = crate::notes::export_bundle(catalog.connection()).map_err(message)?;
    let file = File::create(&path).map_err(|error| format!("No se pudo crear {path}: {error}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file("ugc.json", options)
        .map_err(|error| format!("No se pudo escribir el paquete: {error}"))?;
    let body = serde_json::to_vec_pretty(&bundle)
        .map_err(|error| format!("No se pudo serializar la exportación: {error}"))?;
    zip.write_all(&body)
        .map_err(|error| format!("No se pudo escribir el JSON: {error}"))?;
    zip.finish()
        .map_err(|error| format!("No se pudo cerrar el paquete: {error}"))?;
    Ok(NotesExportResult {
        path,
        notebooks: bundle.notebooks.len(),
        notes: bundle.notes.len(),
        anchors: bundle.anchors.len(),
        highlights: bundle.highlights.len(),
        tags: bundle.tags.len(),
    })
}

#[tauri::command]
pub fn import_notes(
    state: State<'_, AppState>,
    path: String,
) -> Result<NotesImportResult, String> {
    let file = File::open(&path).map_err(|error| format!("No se pudo abrir {path}: {error}"))?;
    let bundle = match ZipArchive::new(file) {
        Ok(mut archive) => {
            let mut entry = archive
                .by_name("ugc.json")
                .map_err(|error| format!("El paquete no contiene ugc.json: {error}"))?;
            let mut body = String::new();
            entry
                .read_to_string(&mut body)
                .map_err(|error| format!("No se pudo leer ugc.json: {error}"))?;
            serde_json::from_str::<UgcBundle>(&body)
                .map_err(|error| format!("JSON de notas inválido: {error}"))?
        }
        Err(_) => {
            let body = std::fs::read_to_string(&path)
                .map_err(|error| format!("No se pudo leer {path}: {error}"))?;
            serde_json::from_str::<UgcBundle>(&body)
                .map_err(|error| format!("JSON de notas inválido: {error}"))?
        }
    };
    let mut catalog = state.catalog.lock().map_err(message)?;
    let (notebooks, notes, anchors, highlights, tags) =
        crate::notes::import_bundle(catalog.connection_mut(), &bundle).map_err(message)?;
    Ok(NotesImportResult {
        notebooks,
        notes,
        anchors,
        highlights,
        tags,
    })
}

#[tauri::command]
pub fn read_image_data_url(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|error| format!("No se pudo leer la imagen: {error}"))?;
    let extension = std::path::Path::new(&path)
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn import_interlinear(
    state: State<'_, AppState>,
    path: String,
) -> Result<InterlinearImportReport, String> {
    let mut catalog = state.catalog.lock().map_err(message)?;
    crate::interlinear::import_stepbible(&mut catalog, path).map_err(message)
}

#[tauri::command]
pub fn interlinear_status(state: State<'_, AppState>) -> Result<InterlinearStatus, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::interlinear::status(&catalog).map_err(message)
}

#[tauri::command]
pub fn get_interlinear_chapter(
    state: State<'_, AppState>,
    book: i64,
    chapter: i64,
) -> Result<Vec<InterlinearVerse>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::interlinear::chapter(&catalog, book, chapter).map_err(message)
}

#[cfg(target_os = "windows")]
fn hidden_powershell(script: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut command = Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script])
        .creation_flags(0x08000000); // CREATE_NO_WINDOW
    command
}

fn tts_base_url(server_url: Option<String>) -> String {
    server_url
        .unwrap_or_else(|| "http://127.0.0.1:8000".to_string())
        .trim_end_matches('/')
        .to_string()
}

#[tauri::command]
pub async fn tts_health(server_url: Option<String>) -> Result<TtsHealth, String> {
    let url = format!("{}/health", tts_base_url(server_url));
    let response = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(4))
        .send()
        .await
        .map_err(|error| format!("No se pudo contactar el servidor TTS en {url}: {error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("Servidor TTS HTTP {}: {}", status.as_u16(), body));
    }
    serde_json::from_str(&body).map_err(|error| format!("Respuesta TTS inválida: {error}"))
}

#[tauri::command]
pub async fn tts_voices(server_url: Option<String>) -> Result<TtsVoiceList, String> {
    let url = format!("{}/api/v1/voices", tts_base_url(server_url));
    let response = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(4))
        .send()
        .await
        .map_err(|error| format!("No se pudo contactar el servidor TTS en {url}: {error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("Servidor TTS HTTP {}: {}", status.as_u16(), body));
    }
    serde_json::from_str(&body).map_err(|error| format!("Respuesta TTS inválida: {error}"))
}

#[tauri::command]
pub async fn tts_synthesize(
    text: String,
    voice_id: String,
    speed: f64,
    server_url: Option<String>,
) -> Result<TtsAudio, String> {
    if text.trim().is_empty() {
        return Err("No hay texto para leer.".to_string());
    }
    let url = format!("{}/api/v1/tts", tts_base_url(server_url));
    let response = reqwest::Client::new()
        .post(&url)
        .json(&serde_json::json!({
            "text": text,
            "voice_id": voice_id,
            "speed": speed,
            "stream": false
        }))
        .timeout(std::time::Duration::from_secs(180))
        .send()
        .await
        .map_err(|error| format!("No se pudo contactar el servidor TTS en {url}: {error}"))?;
    let status = response.status();
    let sample_rate = response
        .headers()
        .get("x-sample-rate")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(24000);
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("No se pudo leer el audio TTS: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Servidor TTS HTTP {}: {}",
            status.as_u16(),
            String::from_utf8_lossy(&bytes)
        ));
    }
    Ok(TtsAudio {
        audio_base64: STANDARD.encode(bytes),
        mime: "audio/wav".to_string(),
        sample_rate,
    })
}

#[tauri::command]
pub async fn tts_system_voices() -> Result<Vec<TtsVoice>, String> {
    tauri::async_runtime::spawn_blocking(system_voices_impl)
        .await
        .map_err(|error| format!("Tarea de voces interrumpida: {error}"))?
}

#[tauri::command]
pub async fn tts_system_synthesize(
    text: String,
    voice_id: String,
    speed: f64,
) -> Result<TtsAudio, String> {
    if text.trim().is_empty() {
        return Err("No hay texto para leer.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        system_synthesize_impl(text, voice_id, speed)
    })
    .await
    .map_err(|error| format!("Tarea de síntesis interrumpida: {error}"))?
}

fn system_voices_impl() -> Result<Vec<TtsVoice>, String> {
    #[cfg(target_os = "windows")]
    {
        return windows_voices();
    }
    #[cfg(target_os = "macos")]
    {
        return macos_voices();
    }
    #[cfg(target_os = "linux")]
    {
        return linux_voices();
    }
    #[allow(unreachable_code)]
    Err("Este sistema operativo no tiene un motor de voz configurado.".to_string())
}

fn system_synthesize_impl(
    text: String,
    voice_id: String,
    speed: f64,
) -> Result<TtsAudio, String> {
    #[cfg(target_os = "windows")]
    {
        return windows_synthesize(text, voice_id, speed);
    }
    #[cfg(target_os = "macos")]
    {
        return macos_synthesize(text, voice_id, speed);
    }
    #[cfg(target_os = "linux")]
    {
        return linux_synthesize(text, voice_id, speed);
    }
    #[allow(unreachable_code)]
    Err("Este sistema operativo no tiene un motor de voz configurado.".to_string())
}

fn voice(
    id: String,
    name: String,
    language: String,
    description: String,
) -> TtsVoice {
    TtsVoice {
        voice_id: id,
        display_name: name,
        reference_audio_path: String::new(),
        reference_text: String::new(),
        language,
        is_custom_clone: false,
        speaker: String::new(),
        description,
        reference_audio_ready: true,
    }
}

#[cfg(target_os = "windows")]
fn windows_voices() -> Result<Vec<TtsVoice>, String> {
    let script = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | Select-Object Name, Culture, Gender | ConvertTo-Json -Compress; $s.Dispose()";
    let output = hidden_powershell(script)
        .output()
        .map_err(|error| format!("No se pudo consultar SAPI: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "SAPI falló: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|error| format!("Respuesta de voces SAPI inválida: {error}"))?;
    let items = match parsed {
        serde_json::Value::Array(items) => items,
        serde_json::Value::Object(_) => vec![parsed],
        _ => Vec::new(),
    };
    let voices = items
        .into_iter()
        .filter_map(|item| {
            let name = item.get("Name")?.as_str()?.to_string();
            let culture = item
                .get("Culture")
                .and_then(|value| value.as_str())
                .unwrap_or("es-MX")
                .to_string();
            Some(voice(
                format!("sapi:{name}"),
                format!("{name} ({culture})"),
                culture,
                "Voz instalada en Windows (SAPI).".to_string(),
            ))
        })
        .collect::<Vec<_>>();
    if voices.is_empty() {
        return Err("Windows no tiene voces SAPI instaladas.".to_string());
    }
    Ok(voices)
}

#[cfg(target_os = "windows")]
fn windows_synthesize(
    text: String,
    voice_id: String,
    speed: f64,
) -> Result<TtsAudio, String> {
    let voice = voice_id.strip_prefix("sapi:").unwrap_or(&voice_id);
    let escaped_voice = voice.replace('\'', "''");
    let cleaned_text = text
        .replace('\'', "''")
        .replace('\r', " ")
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    let path = std::env::temp_dir().join(format!(
        "teoamoxtli-sapi-{}-{stamp}.wav",
        std::process::id()
    ));
    let path_text = path.to_string_lossy().replace('\'', "''");
    let rate = (((speed - 1.0) * 10.0).round() as i32).clamp(-10, 10);
    let script = format!(
        "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; try {{ $s.SelectVoice('{escaped_voice}') }} catch {{}}; $s.Rate = {rate}; $s.SetOutputToWaveFile('{path_text}'); $s.Speak('{cleaned_text}'); $s.Dispose()"
    );
    let output = hidden_powershell(&script)
        .output()
        .map_err(|error| format!("No se pudo ejecutar SAPI: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "SAPI falló: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let bytes = std::fs::read(&path)
        .map_err(|error| format!("SAPI no generó el WAV: {error}"))?;
    let _ = std::fs::remove_file(&path);
    if bytes.len() < 44 {
        return Err("SAPI devolvió un WAV vacío.".to_string());
    }
    Ok(TtsAudio {
        audio_base64: STANDARD.encode(&bytes),
        mime: "audio/wav".to_string(),
        sample_rate: 22050,
    })
}

#[cfg(target_os = "macos")]
fn macos_voices() -> Result<Vec<TtsVoice>, String> {
    let output = Command::new("say")
        .args(["-v", "?"])
        .output()
        .map_err(|error| format!("No se pudo consultar say: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "say falló: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut voices = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some(locale) = trimmed
            .split_whitespace()
            .find(|token| token.contains('_') && token.len() >= 5)
        else {
            continue;
        };
        let Some(index) = trimmed.find(locale) else {
            continue;
        };
        let name = trimmed[..index].trim();
        if name.is_empty() {
            continue;
        }
        voices.push(voice(
            format!("say:{name}"),
            format!("{name} ({locale})"),
            locale.to_string(),
            "Voz instalada en macOS (say).".to_string(),
        ));
    }
    if voices.is_empty() {
        return Err("macOS no devolvió voces instaladas.".to_string());
    }
    Ok(voices)
}

#[cfg(target_os = "macos")]
fn macos_synthesize(
    text: String,
    voice_id: String,
    speed: f64,
) -> Result<TtsAudio, String> {
    let voice = voice_id.strip_prefix("say:").unwrap_or(&voice_id);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    let base = std::env::temp_dir().join(format!(
        "teoamoxtli-say-{}-{stamp}",
        std::process::id()
    ));
    let text_path = base.with_extension("txt");
    let aiff_path = base.with_extension("aiff");
    let wav_path = base.with_extension("wav");
    std::fs::write(&text_path, &text)
        .map_err(|error| format!("No se pudo preparar el texto para say: {error}"))?;
    let rate = ((175.0 * speed).round() as i32).clamp(80, 400);
    let output = Command::new("say")
        .args(["-v", voice, "-r", &rate.to_string(), "-f"])
        .arg(&text_path)
        .arg("-o")
        .arg(&aiff_path)
        .output()
        .map_err(|error| format!("No se pudo ejecutar say: {error}"))?;
    let _ = std::fs::remove_file(&text_path);
    if !output.status.success() {
        let _ = std::fs::remove_file(&aiff_path);
        return Err(format!(
            "say falló: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let converted = Command::new("afconvert")
        .args(["-f", "WAVE", "-d", "LEI16@22050"])
        .arg(&aiff_path)
        .arg(&wav_path)
        .output();
    let (bytes, mime) = if converted.map(|result| result.status.success()).unwrap_or(false) {
        let bytes = std::fs::read(&wav_path)
            .map_err(|error| format!("afconvert no generó el WAV: {error}"))?;
        let _ = std::fs::remove_file(&wav_path);
        (bytes, "audio/wav")
    } else {
        let bytes = std::fs::read(&aiff_path)
            .map_err(|error| format!("say no generó el audio: {error}"))?;
        (bytes, "audio/aiff")
    };
    let _ = std::fs::remove_file(&aiff_path);
    if bytes.len() < 44 {
        return Err("say devolvió un audio vacío.".to_string());
    }
    Ok(TtsAudio {
        audio_base64: STANDARD.encode(&bytes),
        mime: mime.to_string(),
        sample_rate: 22050,
    })
}

#[cfg(target_os = "linux")]
fn linux_voice_binary() -> Option<&'static str> {
    for binary in ["espeak-ng", "espeak"] {
        if Command::new(binary)
            .arg("--version")
            .output()
            .map(|result| result.status.success())
            .unwrap_or(false)
        {
            return Some(binary);
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn linux_voices() -> Result<Vec<TtsVoice>, String> {
    let binary = linux_voice_binary().ok_or_else(|| {
        "Linux no tiene espeak-ng ni espeak. Instala uno: sudo apt install espeak-ng".to_string()
    })?;
    let output = Command::new(binary)
        .arg("--voices=es")
        .output()
        .map_err(|error| format!("No se pudo consultar espeak: {error}"))?;
    let mut voices = Vec::new();
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines().skip(1) {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            let Some(language) = fields.get(1).copied() else {
                continue;
            };
            if !language.starts_with("es") {
                continue;
            }
            voices.push(voice(
                format!("espeak:{language}"),
                format!("Español ({language}) · {binary}"),
                language.to_string(),
                "Voz local de espeak-ng.".to_string(),
            ));
        }
    }
    if voices.is_empty() {
        voices.push(voice(
            "espeak:es".to_string(),
            "Español (espeak)".to_string(),
            "es".to_string(),
            "Voz local de espeak.".to_string(),
        ));
    }
    voices.dedup_by(|left, right| left.voice_id == right.voice_id);
    Ok(voices)
}

#[cfg(target_os = "linux")]
fn linux_synthesize(
    text: String,
    voice_id: String,
    speed: f64,
) -> Result<TtsAudio, String> {
    let binary = linux_voice_binary().ok_or_else(|| {
        "Linux no tiene espeak-ng ni espeak. Instala uno: sudo apt install espeak-ng".to_string()
    })?;
    let voice = voice_id.strip_prefix("espeak:").unwrap_or(&voice_id);
    let rate = ((175.0 * speed).round() as i32).clamp(80, 400);
    let output = Command::new(binary)
        .args(["-v", voice, "-s", &rate.to_string(), "-p", "50", "--stdout", &text])
        .output()
        .map_err(|error| format!("No se pudo ejecutar espeak: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "espeak falló: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    if output.stdout.len() < 44 {
        return Err("espeak devolvió un WAV vacío.".to_string());
    }
    Ok(TtsAudio {
        audio_base64: STANDARD.encode(&output.stdout),
        mime: "audio/wav".to_string(),
        sample_rate: 22050,
    })
}

#[tauri::command]
pub async fn ask_study_assistant(
    state: State<'_, AppState>,
    query: String,
    api_key: String,
    model: Option<String>,
) -> Result<RagAnswer, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err("Escribe una pregunta para el asistente.".to_string());
    }
    let contexts = {
        let catalog = state.catalog.lock().map_err(message)?;
        crate::rag::retrieve(&catalog, &query, 6).map_err(message)?
    };
    let model = model
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "deepseek-chat".to_string());

    if contexts.is_empty() {
        return Ok(RagAnswer {
            answer: "No encontré fragmentos suficientemente relevantes en la biblioteca local. Prueba con otras palabras o importa más recursos.".to_string(),
            contexts,
            model: "local".to_string(),
            local_only: true,
        });
    }
    if api_key.trim().is_empty() {
        return Ok(RagAnswer {
            answer: "Configura una API key de DeepSeek para generar una respuesta. Mientras tanto, aquí están los fragmentos locales recuperados para que puedas revisarlos.".to_string(),
            contexts,
            model: "local".to_string(),
            local_only: true,
        });
    }

    let context_text = contexts
        .iter()
        .enumerate()
        .map(|(index, context)| {
            format!(
                "{}. [ID: {}] {} — {}\n{}",
                index + 1,
                context.id,
                context.resource_title,
                context.label,
                context.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let system_prompt = "Eres un asistente académico experto en teología y estudios bíblicos. Responde la pregunta del usuario utilizando ÚNICAMENTE la información de los fragmentos proporcionados de su biblioteca local. No añadas conocimiento externo ni inventes citas. Si los fragmentos no bastan, di claramente que no tienes suficiente información en la biblioteca local. Cita cada afirmación con el identificador exacto del fragmento entre corchetes, por ejemplo [ID: verse:recurso:43:3:16]. No modifiques los IDs. Responde en español, con una estructura clara y concisa.";
    let user_prompt = format!(
        "Pregunta del usuario:\n{query}\n\nFragmentos recuperados de la biblioteca local:\n{context_text}"
    );
    let endpoint = std::env::var("DEEPSEEK_API_URL")
        .unwrap_or_else(|_| "https://api.deepseek.com/chat/completions".to_string());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|error| format!("No se pudo preparar el cliente HTTP: {error}"))?;
    let response = client
        .post(endpoint)
        .bearer_auth(api_key.trim())
        .json(&serde_json::json!({
            "model": model.clone(),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.2,
            "max_tokens": 1400,
            "stream": false
        }))
        .send()
        .await
        .map_err(|error| format!("No se pudo contactar a DeepSeek: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("No se pudo leer la respuesta de DeepSeek: {error}"))?;
    if !status.is_success() {
        let detail = body.chars().take(400).collect::<String>();
        return Err(format!(
            "DeepSeek respondió HTTP {}: {}",
            status.as_u16(),
            detail
        ));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|error| format!("Respuesta de DeepSeek no válida: {error}"))?;
    let answer = parsed["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "DeepSeek no devolvió contenido en choices[0].message.content.".to_string())?
        .trim()
        .to_string();
    let returned_model = parsed["model"]
        .as_str()
        .unwrap_or(&model)
        .to_string();
    Ok(RagAnswer {
        answer,
        contexts,
        model: returned_model,
        local_only: false,
    })
}

#[tauri::command]
pub fn default_library_path() -> String {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../recursos")
            .to_string_lossy()
            .to_string()
    } else {
        String::new()
    }
}

#[tauri::command]
pub fn sermons_list(state: State<'_, AppState>) -> Result<Vec<Sermon>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::sermon::list_sermons(catalog.connection()).map_err(message)
}

#[tauri::command]
pub fn sermon_get(state: State<'_, AppState>, id: String) -> Result<Option<Sermon>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::sermon::get_sermon(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub fn sermon_create(state: State<'_, AppState>, input: SermonInput) -> Result<Sermon, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::sermon::create_sermon(catalog.connection(), input).map_err(message)
}

#[tauri::command]
pub fn sermon_update(
    state: State<'_, AppState>,
    id: String,
    input: SermonInput,
) -> Result<Sermon, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::sermon::update_sermon(catalog.connection(), &id, input).map_err(message)
}

#[tauri::command]
pub fn sermon_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::sermon::delete_sermon(catalog.connection(), &id).map_err(message)
}

#[tauri::command]
pub async fn pixabay_search(
    api_key: String,
    query: String,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<PixabaySearchResult, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err(
            "Configura tu clave de API de Pixabay en el buscador de imágenes para continuar."
                .to_string(),
        );
    }
    let query = query.trim();
    if query.is_empty() {
        return Err("Escribe qué imagen quieres buscar.".to_string());
    }
    let page = page.unwrap_or(1).max(1);
    let per_page = per_page.unwrap_or(24).clamp(3, 50);
    let mut url = reqwest::Url::parse("https://pixabay.com/api/")
        .map_err(|error| format!("URL de Pixabay no válida: {error}"))?;
    url.query_pairs_mut()
        .append_pair("key", key)
        .append_pair("q", query)
        .append_pair("image_type", "photo")
        .append_pair("safesearch", "true")
        .append_pair("lang", "es")
        .append_pair("per_page", &per_page.to_string())
        .append_pair("page", &page.to_string());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|error| format!("No se pudo preparar la búsqueda de imágenes: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("No se pudo contactar Pixabay: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("No se pudo leer la respuesta de Pixabay: {error}"))?;
    if !status.is_success() {
        let detail = body.chars().take(400).collect::<String>();
        return Err(format!(
            "Pixabay respondió HTTP {}: {detail}",
            status.as_u16()
        ));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|error| format!("Respuesta de Pixabay no válida: {error}"))?;
    let images = parsed["hits"]
        .as_array()
        .map(|hits| {
            hits.iter()
                .map(|hit| PixabayImage {
                    id: hit["id"].as_i64().unwrap_or_default(),
                    preview_url: hit["previewURL"].as_str().unwrap_or_default().to_string(),
                    webformat_url: hit["webformatURL"].as_str().unwrap_or_default().to_string(),
                    large_image_url: hit["largeImageURL"].as_str().unwrap_or_default().to_string(),
                    tags: hit["tags"].as_str().unwrap_or_default().to_string(),
                    user: hit["user"].as_str().unwrap_or_default().to_string(),
                    page_url: hit["pageURL"].as_str().unwrap_or_default().to_string(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(PixabaySearchResult {
        total: parsed["total"].as_i64().unwrap_or(0),
        total_hits: parsed["totalHits"].as_i64().unwrap_or(0),
        images,
    })
}


#[tauri::command]
pub fn global_index_status(state: State<'_, AppState>) -> Result<GlobalIndexStatus, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::indexer::index_status(catalog.connection()).map_err(message)
}

#[tauri::command]
pub fn global_index_resource(
    state: State<'_, AppState>,
    resource_id: String,
) -> Result<IndexReport, String> {
    let mut catalog = state.catalog.lock().map_err(message)?;
    crate::indexer::index_resource(catalog.connection_mut(), &resource_id).map_err(message)
}

#[tauri::command]
pub fn global_index_all(state: State<'_, AppState>) -> Result<Vec<IndexReport>, String> {
    let mut catalog = state.catalog.lock().map_err(message)?;
    crate::indexer::reindex_catalog(&mut catalog).map_err(message)
}

#[tauri::command]
pub fn global_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
    resource_id: Option<String>,
) -> Result<Vec<GlobalSearchHit>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::indexer::global_search(
        catalog.connection(),
        &query,
        limit.unwrap_or(50),
        resource_id.as_deref(),
    )
    .map_err(message)
}


#[tauri::command]
pub fn search_by_passage_range(
    state: State<'_, AppState>,
    book: i64,
    chapter: i64,
    verse_start: i64,
    verse_end: Option<i64>,
) -> Result<Vec<PassageRangeHit>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::indexer_v2::passage_range_search(
        catalog.connection(),
        book,
        chapter,
        verse_start,
        verse_end,
    )
    .map_err(message)
}

#[tauri::command]
pub fn search_advanced(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
    expand_by_strong: Option<bool>,
) -> Result<Vec<UnifiedSearchResult>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::indexer_v2::search_v2(
        catalog.connection(),
        &query,
        limit.unwrap_or(80),
        expand_by_strong.unwrap_or(false),
    )
    .map_err(message)
}

#[tauri::command]
pub fn search_everything(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<UnifiedSearchResult>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::indexer::search_everything(catalog.connection(), &query, limit.unwrap_or(50))
        .map_err(message)
}


#[tauri::command]
pub async fn export_slides(
    path: String,
    format: String,
    slides: Vec<SlideExport>,
) -> Result<String, String> {
    crate::export::export(path, format, slides)
        .await
        .map_err(message)
}


#[tauri::command]
pub fn export_document(
    path: String,
    format: String,
    title: String,
    blocks: Vec<DocumentBlock>,
) -> Result<String, String> {
    crate::document_export::export_document(path, format, title, blocks)
        .map_err(message)
}

#[tauri::command]
pub async fn download_to_base64(url: String) -> Result<String, String> {
    if url.starts_with("data:") {
        return Ok(url);
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("La imagen no es una URL válida.".to_string());
    }
    let response = reqwest::get(&url)
        .await
        .map_err(|error| format!("No se pudo descargar la imagen: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("La imagen respondió con {}.", response.status()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/jpeg")
        .split(';')
        .next()
        .unwrap_or("image/jpeg")
        .trim()
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("No se pudo leer la imagen: {error}"))?;
    if bytes.is_empty() {
        return Err("La imagen descargada está vacía.".to_string());
    }
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("La imagen supera el límite de 20 MB.".to_string());
    }
    Ok(format!(
        "data:{content_type};base64,{}",
        STANDARD.encode(bytes)
    ))
}


#[tauri::command]
pub fn set_resource_priority(
    state: State<'_, AppState>,
    resource_id: String,
    priority: i64,
) -> Result<(), String> {
    let catalog = state.catalog.lock().map_err(message)?;
    catalog
        .set_resource_priority(&resource_id, priority != 0)
        .map_err(message)
}


#[tauri::command]
pub fn word_study(
    state: State<'_, AppState>,
    strong: String,
    limit: Option<usize>,
) -> Result<WordStudyResult, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::wordstudy::study(catalog.connection(), &strong, limit.unwrap_or(120))
        .map_err(message)
}

#[tauri::command]
pub fn word_study_search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<StrongEntry>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::wordstudy::search(catalog.connection(), &query, limit.unwrap_or(30))
        .map_err(message)
}

#[tauri::command]
pub fn word_study_reference(
    state: State<'_, AppState>,
    book: i64,
    chapter: i64,
    verse: i64,
) -> Result<Vec<WordOccurrence>, String> {
    let catalog = state.catalog.lock().map_err(message)?;
    crate::wordstudy::reference(catalog.connection(), book, chapter, verse)
        .map_err(message)
}

