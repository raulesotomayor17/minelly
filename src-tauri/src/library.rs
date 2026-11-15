use std::path::Path;

use anyhow::{anyhow, Result};

use serde::Serialize;

use crate::db::Catalog;
use crate::model::{EpubChapter, EpubChapterSummary, Resource, ResourceKind};

const STRUCTURE_VERSION: i64 = 2;

fn mark_normalized(catalog: &mut Catalog, resource: &Resource, chapter_count: i64) -> Result<()> {
    let mut updated = resource.clone();
    updated.entry_count = chapter_count;
    if !updated.metadata.is_object() {
        updated.metadata = serde_json::json!({});
    }
    if let Some(metadata) = updated.metadata.as_object_mut() {
        metadata.insert(
            "structureVersion".to_string(),
            serde_json::json!(STRUCTURE_VERSION),
        );
    }
    catalog.upsert_resource(&updated)
}

pub(crate) fn store_chapters(
    catalog: &mut Catalog,
    resource: &Resource,
    chapters: &[EpubChapter],
) -> Result<()> {
    catalog.replace_epub_chapters(&resource.id, chapters)?;
    catalog.replace_pbb_fts(&resource.id, chapters)?;

    let tag_re = regex::Regex::new(r"<[^>]+>").expect("regex válida");
    {
        let conn = catalog.connection();
        conn.execute(
            "DELETE FROM global_search_index WHERE resource_id = ?1",
            [&resource.id],
        )?;
        for chapter in chapters {
            let text = tag_re
                .replace_all(&chapter.html, " ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            conn.execute(
                "INSERT INTO global_search_index(resource_id, module_type, reference_key, content_text)
                 VALUES (?1, 'book', ?2, ?3)",
                rusqlite::params![resource.id, chapter.title, text],
            )?;
        }
    }

    mark_normalized(catalog, resource, chapters.len() as i64)
}

fn clean_heading_text(raw: &str) -> String {
    let tag_re = regex::Regex::new(r"(?is)<[^>]+>").unwrap();
    let text = tag_re.replace_all(raw, " ");
    let text = text
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Reconstruye capítulos a partir de los encabezados del propio libro.
/// Se usa con formatos sin EPUB de origen (PBB y similares).
pub fn chapters_from_headings(chapters: &[EpubChapter]) -> Vec<EpubChapter> {
    let combined = chapters
        .iter()
        .map(|chapter| chapter.html.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    if combined.trim().is_empty() {
        return Vec::new();
    }

    let heading_re = regex::Regex::new(r"(?is)<h([1-6])(?:\s[^>]*)?>(.*?)</h[1-6]>").unwrap();
    let section_re =
        regex::Regex::new(r"(?i)^\s*(?:§|cap[íi]tulo|chapter|lecci[óo]n|lesson)\s*[\dIVXLC]")
            .unwrap();

    let mut candidates: Vec<(usize, String)> = Vec::new();
    for caps in heading_re.captures_iter(&combined) {
        let Some(whole) = caps.get(0) else { continue };
        let title = clean_heading_text(caps.get(2).map(|m| m.as_str()).unwrap_or(""));
        if title.len() < 2 {
            continue;
        }
        candidates.push((whole.start(), title));
    }
    if candidates.len() < 3 {
        return Vec::new();
    }

    let mut chosen: Vec<(usize, String)> = candidates
        .iter()
        .filter(|(_, title)| section_re.is_match(title))
        .cloned()
        .collect();

    if chosen.len() < 3 {
        chosen = candidates
            .iter()
            .filter(|(_, title)| {
                let upper = title.to_uppercase();
                title.len() >= 4
                    && !upper.starts_with("PART ")
                    && !upper.starts_with("PARTE ")
                    && !upper.starts_with("FURTHER READING")
                    && !upper.starts_with("BIBLIOGRAF")
                    && !upper.starts_with("ÍNDICE")
                    && !upper.starts_with("INDICE")
            })
            .cloned()
            .collect();
    }

    chosen.sort_by_key(|(start, _)| *start);
    chosen.dedup_by_key(|(start, _)| *start);
    if chosen.len() < 3 {
        return Vec::new();
    }

    let mut result: Vec<EpubChapter> = Vec::new();
    if chosen[0].0 > 0 {
        let front = &combined[..chosen[0].0];
        if front.trim().len() > 120 {
            result.push(EpubChapter {
                spine: 0,
                title: "Portada y créditos".to_string(),
                href: "pbb://chapter/0".to_string(),
                html: front.to_string(),
            });
        }
    }

    for (index, (start, title)) in chosen.iter().enumerate() {
        let end = chosen
            .get(index + 1)
            .map(|(next, _)| *next)
            .unwrap_or(combined.len());
        if end <= *start {
            continue;
        }
        let html = combined[*start..end].to_string();
        if html.trim().is_empty() {
            continue;
        }
        let spine = result.len() as i64;
        result.push(EpubChapter {
            spine,
            title: title.clone(),
            href: format!("pbb://chapter/{spine}"),
            html,
        });
    }

    result
}

fn is_broken_structure(chapters: &[EpubChapter]) -> bool {
    if chapters.is_empty() {
        return false;
    }
    let huge = chapters.iter().any(|chapter| chapter.html.len() > 120_000);
    let stubs = chapters
        .iter()
        .filter(|chapter| chapter.html.len() < 200)
        .count();
    huge || stubs >= 3
}

fn rebuild_from_headings(
    catalog: &mut Catalog,
    resource: &Resource,
    current: &[EpubChapter],
) -> Result<i64> {
    if !is_broken_structure(current) {
        return Ok(current.len() as i64);
    }
    let chapters = chapters_from_headings(current);
    if chapters.len() < 3 {
        return Err(anyhow!(
            "No se detectaron encabezados de capítulo suficientes."
        ));
    }
    store_chapters(catalog, resource, &chapters)?;
    Ok(chapters.len() as i64)
}

/// Restaura la estructura de un libro EPUB a partir de su archivo original.
///
/// Agrupa los documentos del spine por el índice del EPUB, reescribe los
/// capítulos, reconstruye el índice de búsqueda del libro y deja intactas las
/// notas, resaltados y marcadores (que no viven en `epub_chapters`). Es la vía
/// de reparación cuando una reconstrucción sucesiva dejó capítulos duplicados
/// o vacíos.
pub fn restore_epub_from_source(
    catalog: &mut Catalog,
    resource_id: &str,
) -> Result<Vec<EpubChapterSummary>> {
    let resource = catalog
        .get_resource(resource_id)?
        .ok_or_else(|| anyhow!("No se encontró el libro."))?;

    if resource.source_format != "epub" {
        return Err(anyhow!(
            "Solo los libros EPUB pueden restaurarse desde su archivo original."
        ));
    }

    let path = Path::new(&resource.source_path);
    if !path.exists() {
        return Err(anyhow!(
            "No se encuentra el archivo original: {}",
            resource.source_path
        ));
    }

    let parsed = crate::import::epub::read_epub_package(path)?;
    let chapters = crate::import::epub::chapters_from_toc(&parsed);
    if chapters.is_empty() {
        return Err(anyhow!("El EPUB original no contiene capítulos legibles."));
    }

    store_chapters(catalog, &resource, &chapters)?;
    catalog.epub_chapters(resource_id)
}

/// Informe de la revisión automática de un libro.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookStructureReport {
    pub resource_id: String,
    pub title: String,
    pub before: i64,
    pub after: i64,
    pub changed: bool,
    pub error: Option<String>,
}

fn is_normalized(resource: &crate::model::Resource) -> bool {
    resource
        .metadata
        .get("structureVersion")
        .and_then(|value| value.as_i64())
        .unwrap_or(0)
        >= 2
}

/// Revisa todos los libros EPUB y reconstruye el índice de los que todavía no
/// han pasado por el escáner. Es idempotente: los libros ya normalizados se
/// omiten salvo que se fuerce la revisión.
pub fn scan_book_structures(catalog: &mut Catalog, force: bool) -> Vec<BookStructureReport> {
    let resources = match catalog.list_resources() {
        Ok(resources) => resources,
        Err(_) => return Vec::new(),
    };

    let mut reports = Vec::new();
    for resource in resources {
        if resource.kind != ResourceKind::Book {
            continue;
        }
        let is_epub = resource.source_format == "epub";
        let is_pbb = resource.source_format == "pbb";
        if !is_epub && !is_pbb {
            continue;
        }
        if !force && is_normalized(&resource) {
            continue;
        }
        let current = catalog.epub_chapters_full(&resource.id).unwrap_or_default();
        let before = current.len() as i64;
        let result = if is_epub {
            restore_epub_from_source(catalog, &resource.id).map(|chapters| chapters.len() as i64)
        } else {
            rebuild_from_headings(catalog, &resource, &current)
        };
        match result {
            Ok(after) => reports.push(BookStructureReport {
                resource_id: resource.id.clone(),
                title: resource.title.clone(),
                before,
                after,
                changed: after != before,
                error: None,
            }),
            Err(error) => reports.push(BookStructureReport {
                resource_id: resource.id.clone(),
                title: resource.title.clone(),
                before,
                after: before,
                changed: false,
                error: Some(error.to_string()),
            }),
        }
    }
    reports
}
