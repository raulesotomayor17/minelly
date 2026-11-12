use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

use anyhow::{anyhow, Context, Result};
use serde_json::json;

use crate::db::{now_epoch, Catalog};
use crate::import::docx::read_docx;
use crate::import::epub::read_epub_package;
use crate::model::{
    EpubChapter, PbbBook, PbbBuildRequest, PbbBuildResult, PbbDiagnostic, PbbMetadata,
    PbbSourceInput, PbbSourceRecord, PbbStage, Resource, ResourceKind,
};

struct CompiledArticle {
    title: String,
    html: String,
}

const RESOURCE_TYPES: &[&str] = &[
    "Bible",
    "Monograph",
    "Commentary",
    "Bible Harmony",
    "Sermon",
    "Lexicon",
];

struct Compiler {
    diagnostics: Vec<PbbDiagnostic>,
    log: Vec<String>,
    stages: Vec<PbbStage>,
}

impl Compiler {
    fn new() -> Self {
        Self {
            diagnostics: Vec::new(),
            log: vec![format!(
                "[{}] Personal Book Builder iniciado.",
                now_epoch()
            )],
            stages: vec![
                stage(1, "Starting"),
                stage(2, "Converting"),
                stage(3, "Compiling"),
                stage(4, "Discovering"),
            ],
        }
    }

    fn log(&mut self, message: impl Into<String>) {
        self.log
            .push(format!("[{}] {}", now_epoch(), message.into()));
    }

    fn start(&mut self, id: i64, detail: impl Into<String>) {
        if let Some(stage) = self.stages.iter_mut().find(|stage| stage.id == id) {
            stage.status = "running".to_string();
            stage.detail = detail.into();
        }
    }

    fn finish(&mut self, id: i64) {
        if let Some(stage) = self.stages.iter_mut().find(|stage| stage.id == id) {
            stage.status = "completed".to_string();
        }
    }

    fn fail(&mut self, id: i64, detail: impl Into<String>) {
        if let Some(stage) = self.stages.iter_mut().find(|stage| stage.id == id) {
            stage.status = "failed".to_string();
            stage.detail = detail.into();
        }
        for stage in &mut self.stages {
            if stage.id > id && stage.status == "pending" {
                stage.status = "skipped".to_string();
            }
        }
    }

    fn add(&mut self, code: &str, severity: &str, message: impl Into<String>, source: &str) {
        self.diagnostics.push(PbbDiagnostic {
            code: code.to_string(),
            severity: severity.to_string(),
            message: message.into(),
            source: source.to_string(),
        });
    }

    fn error(&mut self, code: &str, message: impl Into<String>, source: &str) {
        self.add(code, "error", message, source);
    }

    fn warning(&mut self, code: &str, message: impl Into<String>, source: &str) {
        self.add(code, "warning", message, source);
    }

    fn info(&mut self, code: &str, message: impl Into<String>, source: &str) {
        self.add(code, "info", message, source);
    }

    fn error_count(&self) -> i64 {
        self.diagnostics
            .iter()
            .filter(|item| item.severity == "error")
            .count() as i64
    }

    fn warning_count(&self) -> i64 {
        self.diagnostics
            .iter()
            .filter(|item| item.severity == "warning")
            .count() as i64
    }

    fn write_log(&self, data_dir: &Path, resource_hint: &str) -> Result<String> {
        let logs = data_dir.join("logs");
        fs::create_dir_all(&logs)?;
        let path = logs.join(format!(
            "pbb-{}-{}.log",
            now_epoch(),
            slugify(resource_hint)
        ));
        let mut body = self.log.clone();
        body.push(String::new());
        body.push("=== DIAGNÓSTICO ===".to_string());
        for item in &self.diagnostics {
            body.push(format!(
                "[{}] {} ({}): {}",
                item.severity.to_ascii_uppercase(),
                item.code,
                item.source,
                item.message
            ));
        }
        body.push(String::new());
        body.push(format!(
            "Errores: {} · Advertencias: {}",
            self.error_count(),
            self.warning_count()
        ));
        fs::write(&path, body.join("\n"))?;
        Ok(path.to_string_lossy().to_string())
    }
}

pub fn build(
    catalog: &mut Catalog,
    request: &PbbBuildRequest,
    data_dir: &Path,
) -> Result<PbbBuildResult> {
    let mut compiler = Compiler::new();
    let metadata = normalize_metadata(&request.metadata, &mut compiler);
    compiler.start(1, "Creando identificador y registro de diagnóstico.");

    let existing = request
        .existing_resource_id
        .as_deref()
        .and_then(|id| catalog.pbb_book(id).ok().flatten());
    let resource_id = existing
        .as_ref()
        .map(|book| book.resource_id.clone())
        .unwrap_or_else(|| {
            format!(
                "pbb:{}-{}",
                slugify(&metadata.title),
                now_epoch()
            )
        });
    compiler.log(format!("Identificador PBB: {resource_id}"));
    compiler.log(format!("Título: {}", metadata.title));
    compiler.log(format!(
        "Tipo: {} · Idioma: {}",
        metadata.resource_type, metadata.language
    ));

    if metadata.title.is_empty() {
        compiler.error("MISSING_TITLE", "El título es obligatorio.", "metadata");
    }
    if !RESOURCE_TYPES.contains(&metadata.resource_type.as_str()) {
        compiler.error(
            "INVALID_TYPE",
            format!("Tipo de recurso no válido: {}", metadata.resource_type),
            "metadata",
        );
    }
    if metadata.language.trim().is_empty() {
        compiler.error("MISSING_LANGUAGE", "El idioma es obligatorio.", "metadata");
    }
    let mut sources = request.sources.clone();
    sources.sort_by_key(|source| source.order_index);
    if sources.is_empty() {
        compiler.error("NO_SOURCES", "Añade al menos un documento fuente.", "queue");
    }

    if compiler.error_count() > 0 {
        compiler.fail(1, "Metadatos incompletos.");
        let log_path = compiler.write_log(data_dir, &metadata.title)?;
        return Ok(result("failed", &compiler, log_path, resource_id, &metadata.title));
    }
    compiler.finish(1);
    compiler.start(2, "Convirtiendo documentos y normalizando estilos.");

    let mut articles = Vec::new();
    let mut cover_fallback: Option<(String, Vec<u8>)> = None;
    for (index, source) in sources.iter().enumerate() {
        let path = PathBuf::from(&source.path);
        let label = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| source.path.clone());
        compiler.log(format!("Fuente {}: {}", index + 1, path.display()));
        if !path.is_file() {
            compiler.error(
                "SOURCE_MISSING",
                format!("No existe el archivo fuente: {}", path.display()),
                &label,
            );
            continue;
        }
        let extension = path
            .extension()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();

        if matches!(extension.as_str(), "epub" | "azw3" | "mobi") {
            let epub_path = if extension == "epub" {
                path.clone()
            } else {
                match convert_ebook_to_epub(&path, data_dir, index, &extension) {
                    Ok(converted) => {
                        compiler.log(format!(
                            "{} convertido con Calibre a {}",
                            extension.to_ascii_uppercase(),
                            converted.display()
                        ));
                        compiler.info(
                            "EBOOK_CONVERTED",
                            format!(
                                "{} convertido a EPUB estructurado con Calibre ebook-convert.",
                                extension.to_ascii_uppercase()
                            ),
                            &label,
                        );
                        converted
                    }
                    Err(error) => {
                        compiler.error("EBOOK_CONVERSION_FAILED", error.to_string(), &label);
                        continue;
                    }
                }
            };

            match read_epub_package(&epub_path) {
                Ok(parsed) => {
                    for warning in parsed.warnings {
                        compiler.warning("EPUB_WARNING", warning, &label);
                    }
                    let refs: usize = parsed
                        .chapters
                        .iter()
                        .map(|ch| ch.html.matches("class=\"scripture-ref\"").count())
                        .sum();
                    compiler.log(format!(
                        "{} leído: {} capítulos jerárquicos, {} referencias bíblicas.",
                        extension.to_ascii_uppercase(),
                        parsed.chapters.len(),
                        refs
                    ));
                    if refs > 0 {
                        compiler.info(
                            "SCRIPTURE_REFERENCE_TAGGER",
                            format!("{refs} referencias bíblicas detectadas."),
                            &label,
                        );
                    }
                    for ch in parsed.chapters {
                        articles.push(CompiledArticle {
                            title: ch.title,
                            html: ch.html,
                        });
                    }
                }
                Err(error) => compiler.error("EPUB_PARSE_FAILED", error.to_string(), &label),
            }
            continue;
        }

        let docx_path = if extension == "pdf" {
            match convert_pdf(&path, data_dir, index) {
                Ok(converted) => {
                    compiler.log(format!(
                        "PDF convertido con Calibre a {}",
                        converted.display()
                    ));
                    compiler.info(
                        "PDF_CONVERTED",
                        "PDF convertido a DOCX con Calibre ebook-convert.",
                        &label,
                    );
                    converted
                }
                Err(error) => {
                    compiler.error("PDF_CONVERSION_FAILED", error.to_string(), &label);
                    continue;
                }
            }
        } else if extension == "docx" {
            path.clone()
        } else {
            compiler.error(
                "UNSUPPORTED_FORMAT",
                format!(
                    "Formato no admitido para PBB: .{extension} (se admiten .docx, .epub, .azw3, .mobi, .pdf)"
                ),
                &label,
            );
            continue;
        };

        match read_docx(&docx_path) {
            Ok(document) => {
                if cover_fallback.is_none() {
                    cover_fallback = document.cover.clone();
                }
                compiler.log(format!(
                    "DOCX leído: {} artículos, {} referencias bíblicas.",
                    document.articles.len(),
                    document
                        .articles
                        .iter()
                        .map(|article| article.scripture_refs)
                        .sum::<usize>()
                ));
                if document.author.is_empty() {
                    compiler.log("Sin autor en docProps/core.xml.");
                }
                for issue in document.issues {
                    compiler.add(
                        &issue.code,
                        &issue.severity,
                        issue.message,
                        &label,
                    );
                }
                let refs = document
                    .articles
                    .iter()
                    .map(|article| article.scripture_refs)
                    .sum::<usize>();
                if refs > 0 {
                    compiler.info(
                        "SCRIPTURE_REFERENCE_TAGGER",
                        format!("{refs} referencias bíblicas detectadas."),
                        &label,
                    );
                }
                for article in document.articles {
                    articles.push(CompiledArticle {
                        title: article.title,
                        html: article.html,
                    });
                }
            }
            Err(error) => compiler.error("DOCX_PARSE_FAILED", error.to_string(), &label),
        }
    }

    if articles.is_empty() {
        compiler.error(
            "EMPTY_BOOK",
            "No se generó ningún artículo a partir de las fuentes.",
            "compiler",
        );
    }
    if compiler.error_count() > 0 {
        compiler.fail(2, "La validación encontró errores.");
        let log_path = compiler.write_log(data_dir, &metadata.title)?;
        return Ok(result("failed", &compiler, log_path, resource_id, &metadata.title));
    }
    compiler.finish(2);
    compiler.start(3, "Compilando capítulos, SQLite y el índice FTS5.");

    let cover_path = save_cover(
        data_dir,
        &resource_id,
        &metadata.cover_image_path,
        cover_fallback,
        &mut compiler,
    );
    let raw_chapters = articles
        .iter()
        .map(|article| crate::editorial::RawChapter {
            title: article.title.clone(),
            html: article.html.clone(),
        })
        .collect::<Vec<_>>();
    let structured = crate::editorial::reconstruct_book_chapters_and_toc(raw_chapters);
    let chapters = structured
        .into_iter()
        .map(|chapter| EpubChapter {
            spine: chapter.spine,
            title: chapter.title,
            href: chapter.href.replace("pbb://", &format!("pbb://{resource_id}/")),
            html: chapter.html,
        })
        .collect::<Vec<_>>();

    let custom_json = serde_json::to_value(&metadata.custom_attributes)?;
    let source_path = sources
        .iter()
        .map(|source| source.path.clone())
        .collect::<Vec<_>>()
        .join(";");
    let resource = Resource {
        id: resource_id.clone(),
        kind: ResourceKind::Book,
        title: metadata.title.clone(),
        abbreviation: "PBB".to_string(),
        language: metadata.language.clone(),
        source_format: "pbb".to_string(),
        source_path,
        verse_count: 0,
        entry_count: chapters.len() as i64,
        imported_at: now_epoch(),
        search_priority: 0,
        cloud_synced: false,
        metadata: json!({
            "pbb": true,
            "resourceType": metadata.resource_type.clone(),
            "author": metadata.author.clone(),
            "copyright": metadata.copyright.clone(),
            "description": metadata.description.clone(),
            "coverImagePath": cover_path,
            "customAttributes": custom_json,
            "logPath": "",
        }),
    };

    catalog.upsert_resource(&resource)?;
    catalog.replace_epub_chapters(&resource_id, &chapters)?;
    catalog.replace_pbb_fts(&resource_id, &chapters)?;

    let source_records = sources
        .iter()
        .map(|source| {
            let path = PathBuf::from(&source.path);
            let (modified, size) = file_stamp(&path).unwrap_or((0, 0));
            PbbSourceRecord {
                path: source.path.clone(),
                order_index: source.order_index,
                modified,
                size,
            }
        })
        .collect::<Vec<_>>();
    compiler.finish(3);
    compiler.start(4, "Registrando el recurso en la biblioteca local.");
    let log_path = compiler.write_log(data_dir, &metadata.title)?;
    let created_at = existing
        .as_ref()
        .map(|book| book.created_at)
        .unwrap_or_else(now_epoch);
    let book = PbbBook {
        resource_id: resource_id.clone(),
        title: metadata.title.clone(),
        resource_type: metadata.resource_type.clone(),
        language: metadata.language.clone(),
        author: metadata.author.clone(),
        copyright: metadata.copyright.clone(),
        description: metadata.description.clone(),
        cover_path,
        custom_attributes: metadata.custom_attributes.clone(),
        sources: source_records.clone(),
        log_path: log_path.clone(),
        status: "success".to_string(),
        error_count: 0,
        warning_count: compiler.warning_count(),
        cloud_synced: existing
            .as_ref()
            .map(|book| book.cloud_synced)
            .unwrap_or(false),
        hidden: existing.as_ref().map(|book| book.hidden).unwrap_or(false),
        created_at,
        updated_at: now_epoch(),
    };
    catalog.upsert_pbb_book(&book)?;
    catalog.replace_pbb_sources(&resource_id, &source_records)?;
    compiler.finish(4);
    compiler.log(format!(
        "Libro publicado: {} capítulos; registro {}.",
        chapters.len(),
        resource_id
    ));
    let log_path = compiler.write_log(data_dir, &metadata.title)?;
    Ok(result(
        "success",
        &compiler,
        log_path,
        resource_id,
        &metadata.title,
    ))
}

pub fn recompile(
    catalog: &mut Catalog,
    resource_id: &str,
    data_dir: &Path,
) -> Result<PbbBuildResult> {
    let book = catalog
        .pbb_book(resource_id)?
        .ok_or_else(|| anyhow!("No existe el libro personal {resource_id}"))?;
    let missing = book
        .sources
        .iter()
        .filter(|source| !Path::new(&source.path).is_file())
        .map(|source| source.path.clone())
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        let mut compiler = Compiler::new();
        for path in missing {
            compiler.error(
                "SOURCE_MISSING",
                "El archivo original no existe. Reasócialo antes de recompilar.",
                &path,
            );
        }
        compiler.fail(2, "Falta un archivo fuente.");
        let log_path = compiler.write_log(data_dir, &book.title)?;
        return Ok(result(
            "failed",
            &compiler,
            log_path,
            resource_id.to_string(),
            &book.title,
        ));
    }

    let request = PbbBuildRequest {
        metadata: PbbMetadata {
            title: book.title,
            resource_type: book.resource_type,
            language: book.language,
            author: book.author,
            copyright: book.copyright,
            description: book.description,
            cover_image_path: book.cover_path,
            custom_attributes: book.custom_attributes,
        },
        sources: book
            .sources
            .into_iter()
            .map(|source| PbbSourceInput {
                path: source.path,
                order_index: source.order_index,
            })
            .collect(),
        existing_resource_id: Some(resource_id.to_string()),
    };
    build(catalog, &request, data_dir)
}

fn result(
    status: &str,
    compiler: &Compiler,
    log_path: String,
    resource_id: String,
    title: &str,
) -> PbbBuildResult {
    let message = match status {
        "success" => format!(
            "Compilación completada: {}. Errores: 0, advertencias: {}.",
            title,
            compiler.warning_count()
        ),
        "failed" => format!(
            "La compilación falló: {} error(es). Revisa el registro de diagnóstico.",
            compiler.error_count()
        ),
        _ => "Compilación finalizada.".to_string(),
    };
    PbbBuildResult {
        status: status.to_string(),
        error_count: compiler.error_count(),
        warning_count: compiler.warning_count(),
        log_path,
        resource_id,
        title: title.to_string(),
        stages: compiler.stages.clone(),
        diagnostics: compiler.diagnostics.clone(),
        message,
    }
}

fn normalize_metadata(metadata: &PbbMetadata, compiler: &mut Compiler) -> PbbMetadata {
    let mut result = metadata.clone();
    result.title = result.title.trim().to_string();
    result.language = if result.language.trim().is_empty() {
        "es".to_string()
    } else {
        result.language.trim().to_ascii_lowercase()
    };
    result.resource_type = if result.resource_type.trim().is_empty() {
        "Monograph".to_string()
    } else {
        result.resource_type.trim().to_string()
    };
    if result.title.is_empty() {
        compiler.error("MISSING_TITLE", "El título es obligatorio.", "metadata");
    }
    if result.cover_image_path.trim().is_empty() {
        result.cover_image_path = String::new();
    }
    result
}

fn save_cover(
    data_dir: &Path,
    resource_id: &str,
    selected: &str,
    fallback: Option<(String, Vec<u8>)>,
    compiler: &mut Compiler,
) -> String {
    let covers = data_dir.join("covers");
    let _ = fs::create_dir_all(&covers);
    let target_name = format!("{}.{}", slugify(resource_id), "img");
    let target = covers.join(target_name);
    if !selected.trim().is_empty() {
        let source = Path::new(selected);
        let extension = source
            .extension()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if !matches!(extension.as_str(), "jpg" | "jpeg" | "png") {
            compiler.warning(
                "COVER_FORMAT",
                "La portada debe ser .jpg, .jpeg o .png; se usará la portada del DOCX si existe.",
                "metadata",
            );
        } else if let Ok(bytes) = fs::read(source) {
            let path = covers.join(format!("{}.{}", slugify(resource_id), extension));
            if fs::write(&path, bytes).is_ok() {
                return path.to_string_lossy().to_string();
            }
            compiler.warning("COVER_COPY", "No se pudo copiar la portada.", "metadata");
        } else {
            compiler.warning("COVER_MISSING", "No se pudo leer la portada.", "metadata");
        }
    }
    if let Some((extension, bytes)) = fallback {
        let path = covers.join(format!("{}.{}", slugify(resource_id), extension));
        if fs::write(&path, bytes).is_ok() {
            return path.to_string_lossy().to_string();
        }
    }
    let _ = target;
    String::new()
}

pub fn convert_ebook_to_epub(
    input: &Path,
    data_dir: &Path,
    index: usize,
    ext: &str,
) -> Result<PathBuf> {
    let converter = find_calibre().ok_or_else(|| {
        anyhow!(
            "Calibre ebook-convert no está instalado. Instala Calibre para convertir archivos .{ext}."
        )
    })?;
    let output_dir = data_dir.join("converted");
    fs::create_dir_all(&output_dir)?;
    let stem = input
        .file_stem()
        .map(|s| slugify(&s.to_string_lossy()))
        .unwrap_or_else(|| slugify(ext));
    let output = output_dir.join(format!("pbb-{}-{}-{}.epub", now_epoch(), index, stem));
    let result = Command::new(&converter)
        .arg(input)
        .arg(&output)
        .output()
        .with_context(|| format!("no se pudo ejecutar {}", converter.display()))?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(anyhow!(
            "Calibre no pudo convertir .{ext}: {}",
            stderr.lines().last().unwrap_or("error desconocido")
        ));
    }
    if !output.is_file() {
        return Err(anyhow!("Calibre no generó el EPUB intermedio."));
    }
    Ok(output)
}

fn convert_pdf(input: &Path, data_dir: &Path, index: usize) -> Result<PathBuf> {
    let converter = find_calibre().ok_or_else(|| {
        anyhow!(
            "Calibre ebook-convert no está instalado. Instala Calibre o exporta el PDF a DOCX."
        )
    })?;
    let output_dir = data_dir.join("converted");
    fs::create_dir_all(&output_dir)?;
    let output = output_dir.join(format!("pbb-{}-{}-{}.docx", now_epoch(), index, slugify("pdf")));
    let result = Command::new(&converter)
        .arg(input)
        .arg(&output)
        .output()
        .with_context(|| format!("no se pudo ejecutar {}", converter.display()))?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(anyhow!(
            "Calibre no pudo convertir el PDF: {}",
            stderr.lines().last().unwrap_or("error desconocido")
        ));
    }
    if !output.is_file() {
        return Err(anyhow!("Calibre no generó el DOCX intermedio."));
    }
    Ok(output)
}

pub fn find_calibre() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("CALIBRE_EBOOK_CONVERT") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    let common = [
        "/usr/bin/ebook-convert",
        "/usr/local/bin/ebook-convert",
        "/opt/calibre/ebook-convert",
        r"C:\Program Files\Calibre2\ebook-convert.exe",
        r"C:\Program Files (x86)\Calibre2\ebook-convert.exe",
    ];
    for candidate in common {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Some(path);
        }
    }
    for lookup_cmd in ["which", "where.exe"] {
        if let Ok(output) = Command::new(lookup_cmd).arg("ebook-convert").output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(found) = stdout.lines().map(str::trim).find(|line| !line.is_empty()) {
                    let path = PathBuf::from(found);
                    if path.is_file() {
                        return Some(path);
                    }
                }
            }
        }
    }
    None
}

fn file_stamp(path: &Path) -> Option<(i64, i64)> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    Some((modified, metadata.len() as i64))
}

fn stage(id: i64, name: &str) -> PbbStage {
    PbbStage {
        id,
        name: name.to_string(),
        status: "pending".to_string(),
        detail: String::new(),
    }
}

fn slugify(value: &str) -> String {
    let mut result = String::new();
    let mut previous_dash = false;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            result.push(character);
            previous_dash = false;
        } else if !previous_dash && !result.is_empty() {
            result.push('-');
            previous_dash = true;
        }
    }
    let result = result.trim_matches('-').to_string();
    if result.is_empty() {
        "libro".to_string()
    } else {
        result.chars().take(64).collect()
    }
}
