use std::path::PathBuf;

use teoamoxtli_lib::db::Catalog;
use teoamoxtli_lib::model::{
    PbbBuildRequest, PbbCustomAttribute, PbbMetadata, PbbSourceInput,
};
use teoamoxtli_lib::pbb;

fn main() {
    // Rutas configurables: no se asume ninguna ruta del equipo del desarrollador.
    let data_dir: PathBuf = std::env::var_os("PBB_SMOKE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("minelly-pbb-smoke"));
    let sample_docx = std::env::var("PBB_SAMPLE_DOCX")
        .unwrap_or_else(|_| "pbb-sample.docx".to_string());
    let invalid_docx = std::env::var("PBB_INVALID_DOCX")
        .unwrap_or_else(|_| "pbb-invalid.docx".to_string());
    let _ = std::fs::remove_dir_all(&data_dir);
    std::fs::create_dir_all(&data_dir).expect("data dir");
    let db_path = data_dir.join("catalog.sqlite");
    let mut catalog = Catalog::open(&db_path).expect("catalog");

    let request = PbbBuildRequest {
        metadata: PbbMetadata {
            title: "Estudio de Juan".to_string(),
            resource_type: "Monograph".to_string(),
            language: "es".to_string(),
            author: "Minelly".to_string(),
            copyright: "© 2026".to_string(),
            description: "Prueba del compilador PBB.".to_string(),
            cover_image_path: String::new(),
            custom_attributes: vec![PbbCustomAttribute {
                key: "Publisher".to_string(),
                value: "Prueba".to_string(),
            }],
        },
        sources: vec![PbbSourceInput {
            path: sample_docx.clone(),
            order_index: 0,
        }],
        existing_resource_id: None,
    };

    let result = pbb::build(&mut catalog, &request, &data_dir).expect("build");
    println!("VALID STATUS: {}", result.status);
    println!("VALID ERRORS: {} WARNINGS: {}", result.error_count, result.warning_count);
    println!("VALID RESOURCE: {}", result.resource_id);
    println!("VALID LOG: {}", result.log_path);
    for stage in &result.stages {
        println!("STAGE {} {} {}", stage.id, stage.name, stage.status);
    }
    for diagnostic in &result.diagnostics {
        println!("DIAG {} {} {}", diagnostic.severity, diagnostic.code, diagnostic.message);
    }

    let chapters = catalog.epub_chapters(&result.resource_id).expect("chapters");
    println!("CHAPTERS: {}", chapters.len());
    for chapter in &chapters {
        println!("CHAPTER {} {}", chapter.spine, chapter.title);
    }
    let books = catalog.pbb_books().expect("books");
    println!("PBB BOOKS: {}", books.len());
    if let Some(book) = books.first() {
        println!("BOOK {} {:?}", book.title, book.sources);
    }
    let hits = catalog.pbb_search_fts("Nicodemo", 10).expect("fts");
    println!("FTS HITS: {}", hits.len());
    for hit in hits {
        println!("HIT {} {}", hit.resource_title, hit.label);
    }

    let invalid = PbbBuildRequest {
        metadata: PbbMetadata {
            title: "Inválido".to_string(),
            resource_type: "Monograph".to_string(),
            language: "es".to_string(),
            author: String::new(),
            copyright: String::new(),
            description: String::new(),
            cover_image_path: String::new(),
            custom_attributes: Vec::new(),
        },
        sources: vec![PbbSourceInput {
            path: invalid_docx.clone(),
            order_index: 0,
        }],
        existing_resource_id: None,
    };
    let invalid_result = pbb::build(&mut catalog, &invalid, &data_dir).expect("invalid build");
    println!("INVALID STATUS: {}", invalid_result.status);
    println!("INVALID ERRORS: {}", invalid_result.error_count);
    for diagnostic in &invalid_result.diagnostics {
        println!("INVALID DIAG {} {}", diagnostic.code, diagnostic.message);
    }
}
