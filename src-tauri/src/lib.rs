pub mod books;
pub mod commands;
pub mod db;
pub mod document_export;
pub mod export;
pub mod gbf;
pub mod import;
pub mod indexer;
pub mod indexer_v2;
pub mod reading;
pub mod resource_search;
pub mod editorial;
pub mod learning;
pub mod model;
pub mod interlinear;
pub mod library;
pub mod notes;
pub mod pbb;
pub mod rag;
pub mod sermon;
pub mod typeset;
pub mod wordstudy;

use std::io::{copy as copy_stream, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use flate2::read::GzDecoder;

use tauri::Manager;

use crate::commands::AppState;
use crate::db::Catalog;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unmaximize();
                let _ = window.set_size(tauri::LogicalSize::new(1280.0, 820.0));
                let _ = window.set_position(tauri::LogicalPosition::new(10.0, 10.0));
            }
            let db_path = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/catalog.sqlite")
            } else {
                app.path()
                    .app_data_dir()
                    .map_err(|error| std::io::Error::other(error.to_string()))?
                    .join("catalog.sqlite")
            };
            if !db_path.exists() {
                let mut candidates = Vec::new();
                if let Ok(resource_dir) = app.path().resource_dir() {
                    for folder in [resource_dir.clone(), resource_dir.join("resources")] {
                        candidates.push(folder.join("clean_catalog.sqlite.gz"));
                        candidates.push(folder.join("premium_catalog.sqlite.gz"));
                    }
                }
                if let Ok(exe) = std::env::current_exe() {
                    if let Some(bin_dir) = exe.parent() {
                        for product in ["Minelly Clean", "Minelly Premium", "Minelly"] {
                            let resources = bin_dir.join("../lib").join(product).join("resources");
                            candidates.push(resources.join("clean_catalog.sqlite.gz"));
                            candidates.push(resources.join("premium_catalog.sqlite.gz"));
                        }
                    }
                }
                candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/clean_catalog.sqlite.gz"));
                candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/premium_catalog.sqlite.gz"));
                if let Some(bundle) = candidates.into_iter().find(|path| path.is_file()) {
                    if let Some(parent) = Path::new(&db_path).parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let result = (|| -> std::io::Result<()> {
                        let mut input = GzDecoder::new(std::fs::File::open(&bundle)?);
                        let mut output = std::fs::File::create(&db_path)?;
                        copy_stream(&mut input, &mut output)?;
                        output.flush()?;
                        Ok(())
                    })();
                    if let Err(error) = result {
                        eprintln!("No se pudo instalar el catálogo empaquetado: {error}");
                    }
                }
            }
            let mut catalog = Catalog::open(&db_path).map_err(|error| {
                std::io::Error::other(format!("no se pudo abrir el catálogo: {error:#}"))
            })?;
            let mut wordstudy_candidates = vec![
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("resources/wordstudy.sqlite.gz"),
            ];
            if let Ok(resource_dir) = app.path().resource_dir() {
                wordstudy_candidates.push(resource_dir.join("resources/wordstudy.sqlite.gz"));
                wordstudy_candidates.push(resource_dir.join("wordstudy.sqlite.gz"));
            }
            if let Ok(exe) = std::env::current_exe() {
                if let Some(parent) = exe.parent() {
                    wordstudy_candidates.push(parent.join("resources/wordstudy.sqlite.gz"));
                }
            }
            if let Some(wordstudy_path) = wordstudy_candidates.into_iter().find(|path| path.is_file()) {
                if let Err(error) = catalog.seed_word_study(&wordstudy_path) {
                    eprintln!("No se pudo instalar el estudio de palabra: {error:#}");
                }
            }
            let mut factory_candidates = vec![
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("resources/interlinear_factory.sqlite.gz"),
            ];
            if let Ok(resource_dir) = app.path().resource_dir() {
                factory_candidates.push(resource_dir.join("resources/interlinear_factory.sqlite.gz"));
                factory_candidates.push(resource_dir.join("interlinear_factory.sqlite.gz"));
            }
            if let Some(factory_path) = factory_candidates.into_iter().find(|path| path.is_file()) {
                if let Err(error) = catalog.seed_factory_interlinear(&factory_path) {
                    eprintln!("No se pudo instalar el interlineal de fábrica: {error:#}");
                }
            }
            app.manage(AppState {
                catalog: Mutex::new(catalog),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_resources,
            commands::books,
            commands::get_passage,
            commands::get_book_text,
            commands::get_commentaries,
            commands::epub_chapters,
            commands::get_epub_chapter,
            commands::dictionary_topics,
            commands::lookup_dictionary,
            commands::search,
            commands::import_folder,
            commands::default_library_path,
            commands::pbb_build,
            commands::pbb_recompile,
            commands::pbb_list,
            commands::pbb_delete,
            commands::delete_resource,
            commands::update_resource_metadata,
            commands::set_resource_priority,
            commands::pbb_set_synced,
            commands::pbb_set_hidden,
            commands::pbb_read_log,
            commands::pbb_search,
            commands::notebooks_list,
            commands::notebook_create,
            commands::notebook_update,
            commands::notebook_delete,
            commands::tags_list,
            commands::tag_create,
            commands::tag_delete,
            commands::notes_list,
            commands::note_get,
            commands::note_create,
            commands::note_update,
            commands::note_upsert,
            commands::note_delete,
            commands::notebook_create_node,
            commands::notebook_move,
            commands::note_move,
            commands::note_backlinks,
            commands::highlight_create,
            commands::highlight_delete,
            commands::annotations_for_prefix,
            commands::update_book_chapter_html,
            commands::repair_all_books_typesetting,
            commands::repair_book_typesetting,
            commands::reconstruct_book_structure,
            commands::book_restore_from_source,
            commands::scan_book_structures,
            commands::search_in_resource,
            commands::book_typeset_digest,
            commands::book_typeset_apply,
            commands::book_typeset_undo,
            commands::book_split_chapter_at,
            commands::book_merge_chapter_with_previous,
            commands::book_rename_chapter,
            commands::learning_session_list,
            commands::learning_session_get,
            commands::learning_session_save,
            commands::learning_session_delete,
            commands::knowledge_proposition_add,
            commands::knowledge_graph_list,
            commands::knowledge_proposition_delete,
            commands::reading_progress_get,
            commands::reading_progress_list,
            commands::reading_progress_save,
            commands::toggle_chapter_completed,
            commands::toggle_reading_unit_completed,
            commands::bookmark_set_ribbon,
            commands::bookmark_add,
            commands::bookmark_list,
            commands::bookmark_delete,
            commands::export_notes,
            commands::import_notes,
            commands::read_image_data_url,
            commands::ask_study_assistant,
            commands::import_interlinear,
            commands::interlinear_status,
            commands::get_interlinear_chapter,
            commands::global_index_status,
            commands::global_index_resource,
            commands::global_index_all,
            commands::global_search,
            commands::search_everything,
            commands::search_by_passage_range,
            commands::search_advanced,
            commands::export_slides,
            commands::export_document,
            commands::export_answer_pdf,
            commands::read_file_bytes,
            commands::download_to_base64,
            commands::word_study,
            commands::word_study_search,
            commands::word_study_reference,
            commands::sermons_list,
            commands::sermon_get,
            commands::sermon_create,
            commands::sermon_update,
            commands::sermon_delete,
            commands::pixabay_search,
            commands::tts_health,
            commands::tts_voices,
            commands::tts_synthesize,
            commands::tts_system_voices,
            commands::tts_system_synthesize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
