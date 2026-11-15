use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::LazyLock;

use anyhow::{anyhow, Context, Result};
use regex::Regex;
use serde_json::json;

use crate::db::{now_epoch, Catalog};
use crate::model::{EpubChapter, ImportReport, Resource, ResourceKind};

static CHAPTER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)^\s*(?:(?:cap[íi]tulo|chapter|parte|part|secci[óo]n|introducci[óo]n|pr[óo]logo|ep[íi]logo|conclusi[óo]n|ap[ée]ndice|bibliograf[íi]a)\b|\d{1,2}\s*[.)\-–]\s*\S)",
    )
    .expect("regex válida")
});
static PAGE_NUMBER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^\s*(?:p[áa]gina\s*)?\d{1,4}\s*$").expect("regex"));
static WS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("regex"));

fn run_tool(program: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .with_context(|| format!("no se pudo ejecutar {program}"))?;
    if !output.status.success() {
        return Err(anyhow!(
            "{program} falló: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn pdf_metadata(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(info) = run_tool("pdfinfo", &[&path.to_string_lossy()]) else {
        return (None, None);
    };
    let mut title = None;
    let mut author = None;
    for line in info.lines() {
        if let Some(value) = line.strip_prefix("Title:") {
            let value = value.trim();
            if !value.is_empty() && !value.eq_ignore_ascii_case("untitled") {
                title = Some(value.to_string());
            }
        }
        if let Some(value) = line.strip_prefix("Author:") {
            let value = value.trim();
            if !value.is_empty() {
                author = Some(value.to_string());
            }
        }
    }
    (title, author)
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn normalize_line(line: &str) -> String {
    WS_RE.replace_all(line.trim(), " ").to_string()
}

/// Quita encabezados, pies y números de página repetidos.
fn strip_running_heads(pages: &mut [Vec<String>]) {
    let page_count = pages.len();
    if page_count < 6 {
        return;
    }
    let mut counts: HashMap<String, usize> = HashMap::new();
    for page in pages.iter() {
        let non_empty: Vec<&String> = page.iter().filter(|line| !line.trim().is_empty()).collect();
        let sample = non_empty
            .iter()
            .take(3)
            .chain(non_empty.iter().rev().take(3));
        for line in sample {
            if line.chars().count() <= 90 {
                *counts.entry(normalize_line(line)).or_insert(0) += 1;
            }
        }
    }
    let repeated: Vec<String> = counts
        .into_iter()
        .filter(|(_, count)| *count * 2 >= page_count)
        .map(|(line, _)| line)
        .collect();
    if repeated.is_empty() {
        return;
    }
    for page in pages.iter_mut() {
        page.retain(|line| {
            let normalized = normalize_line(line);
            !repeated.iter().any(|item| *item == normalized)
        });
    }
}

fn join_paragraphs(lines: &[String]) -> Vec<String> {
    let mut paragraphs = Vec::new();
    let mut current = String::new();
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !current.is_empty() {
                paragraphs.push(std::mem::take(&mut current));
            }
            continue;
        }
        if current.is_empty() {
            current = trimmed.to_string();
            continue;
        }
        if current.ends_with('-') {
            current.pop();
            current.push_str(trimmed);
        } else if current.ends_with('—') || current.ends_with('/') {
            current.push_str(trimmed);
        } else {
            current.push(' ');
            current.push_str(trimmed);
        }
    }
    if !current.is_empty() {
        paragraphs.push(current);
    }
    paragraphs
}

fn heading_indexes(paragraphs: &[(String, bool)]) -> Vec<usize> {
    let mut by_text: HashMap<String, usize> = HashMap::new();
    for (index, (paragraph, starts_page)) in paragraphs.iter().enumerate() {
        let text = paragraph.trim();
        // Un capítulo real abre página; así se descartan las listas numeradas del cuerpo.
        if !starts_page || text.chars().count() > 90 || !CHAPTER_RE.is_match(text) {
            continue;
        }
        by_text.insert(normalize_line(text).to_lowercase(), index);
    }
    let mut indexes: Vec<usize> = by_text.into_values().collect();
    indexes.sort_unstable();
    indexes
}

fn build_chapters(title: &str, paragraphs: &[(String, bool)]) -> Vec<EpubChapter> {
    let headings = heading_indexes(paragraphs);
    let heading_set: std::collections::HashSet<usize> = headings.iter().copied().collect();

    let mut chapters: Vec<EpubChapter> = Vec::new();
    if headings.len() >= 3 {
        let mut current_title: Option<String> = None;
        let mut current_html = String::new();
        for (index, (paragraph, _)) in paragraphs.iter().enumerate() {
            let is_heading = heading_set.contains(&index);
            if is_heading {
                if !current_html.trim().is_empty() {
                    let index = chapters.len() as i64;
                    let fallback = if chapters.is_empty() {
                        "Portada y créditos".to_string()
                    } else {
                        format!("Capítulo {}", index + 1)
                    };
                    chapters.push(EpubChapter {
                        spine: index,
                        title: current_title.take().unwrap_or(fallback),
                        href: format!("pbb://chapter/{index}"),
                        html: std::mem::take(&mut current_html),
                    });
                }
                current_title = Some(
                    paragraph
                        .chars()
                        .take(120)
                        .collect::<String>()
                        .trim()
                        .to_string(),
                );
                current_html.push_str(&format!("<h1>{}</h1>", escape_html(paragraph)));
                continue;
            }
            current_html.push_str(&format!("<p>{}</p>", escape_html(paragraph)));
        }
        if !current_html.trim().is_empty() {
            let index = chapters.len() as i64;
            chapters.push(EpubChapter {
                spine: index,
                title: current_title
                    .take()
                    .unwrap_or_else(|| title.to_string()),
                href: format!("pbb://chapter/{index}"),
                html: current_html,
            });
        }
    }

    if chapters.is_empty() {
        let mut html = String::new();
        for (index, (paragraph, _)) in paragraphs.iter().enumerate() {
            if heading_set.contains(&index) {
                html.push_str(&format!("<h1>{}</h1>", escape_html(paragraph)));
            } else {
                html.push_str(&format!("<p>{}</p>", escape_html(paragraph)));
            }
        }
        chapters.push(EpubChapter {
            spine: 0,
            title: title.to_string(),
            href: "pbb://chapter/0".to_string(),
            html,
        });
    }

    chapters
}

pub fn import_pdf(catalog: &mut Catalog, path: &Path) -> Result<ImportReport> {
    let raw = run_tool(
        "pdftotext",
        &["-layout", "-enc", "UTF-8", &path.to_string_lossy(), "-"],
    )
    .context("no se pudo extraer el texto del PDF")?;

    let mut pages: Vec<Vec<String>> = raw
        .split('\u{c}')
        .map(|page| page.lines().map(|line| line.to_string()).collect())
        .collect();
    pages.retain(|page| page.iter().any(|line| !line.trim().is_empty()));
    if pages.is_empty() {
        return Err(anyhow!(
            "El PDF no contiene texto seleccionable (puede ser un escaneo sin OCR)."
        ));
    }

    strip_running_heads(&mut pages);

    let mut paragraphs: Vec<(String, bool)> = Vec::new();
    for page in &pages {
        let cleaned: Vec<String> = page
            .iter()
            .filter(|line| !PAGE_NUMBER_RE.is_match(line))
            .cloned()
            .collect();
        for (position, paragraph) in join_paragraphs(&cleaned).into_iter().enumerate() {
            paragraphs.push((paragraph, position == 0));
        }
    }
    if paragraphs.is_empty() {
        return Err(anyhow!("No se pudo reconstruir el texto del PDF."));
    }

    let (meta_title, meta_author) = pdf_metadata(path);
    let file_stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "Documento PDF".to_string());
    let title = meta_title.unwrap_or_else(|| file_stem.replace('_', " "));
    let chapters = build_chapters(&title, &paragraphs);

    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "documento.pdf".to_string());
    let mut resource = Resource {
        id: format!(
            "pdf:{}",
            file_name.to_ascii_lowercase().replace(' ', "_")
        ),
        kind: ResourceKind::Book,
        title: title.clone(),
        abbreviation: title.chars().take(28).collect(),
        language: "es".to_string(),
        source_format: "pdf".to_string(),
        source_path: path.to_string_lossy().to_string(),
        verse_count: 0,
        entry_count: chapters.len() as i64,
        imported_at: now_epoch(),
        search_priority: 0,
        cloud_synced: false,
        metadata: json!({
            "title": title,
            "creator": meta_author,
            "pages": pages.len(),
            "chapterCount": chapters.len(),
            "extractor": "pdftotext -layout",
        }),
    };

    catalog.upsert_resource(&resource)?;
    catalog.replace_epub_chapters(&resource.id, &chapters)?;
    catalog.replace_pbb_fts(&resource.id, &chapters)?;
    resource.entry_count = chapters.len() as i64;
    catalog.upsert_resource(&resource)?;

    let warnings = if chapters.len() == 1 {
        vec!["PDF importado como un solo bloque; usa «Maquetado IA» para proponer capítulos.".to_string()]
    } else {
        Vec::new()
    };

    Ok(ImportReport { resource, warnings })
}
