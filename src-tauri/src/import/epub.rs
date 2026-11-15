use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::LazyLock;

use anyhow::{anyhow, Context, Result};
use percent_encoding::percent_decode_str;
use regex::Regex;
use roxmltree::Document;
use serde_json::json;
use zip::ZipArchive;

use crate::db::{now_epoch, Catalog};
use crate::model::{EpubChapter, ImportReport, Resource, ResourceKind};

static BODY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<body[^>]*>(.*?)</body>").unwrap());
static TITLE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap());
static HEADING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<h[1-3][^>]*>(.*?)</h[1-3]>").unwrap());
static IMPLICIT_TITLE_P: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<p[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>(.*?)</p>"#).unwrap()
});
static FIRST_HEADING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)^\s*<h[12][^>]*>(.*?)</h[12]>").unwrap());
static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<[^>]+>").unwrap());
static H_TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<(h[1-4])(\b[^>]*)>(.*?)</h[1-4]>").unwrap());
static A_TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)<a\b([^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*)>"#).unwrap());
static ID_ATTR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\bid\s*=\s*["']([^"']+)["']"#).unwrap());
static SCRIPTURE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?:[1-3]\s*)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s+\d{1,3}:\d{1,3}(?:\s*[-–]\s*\d{1,3})?\b",
    )
    .unwrap()
});

#[derive(Clone)]
struct ManifestItem {
    href: String,
    media_type: String,
    properties: String,
}

struct Package {
    title: String,
    creator: Option<String>,
    language: Option<String>,
    identifier: Option<String>,
    version: String,
    opf_dir: String,
    ncx_path: Option<String>,
    nav_path: Option<String>,
    spine: Vec<ManifestItem>,
}

/// Entrada del índice del EPUB: documento, ancla interna y título.
#[derive(Clone)]
pub struct TocEntry {
    pub path: String,
    pub fragment: String,
    pub title: String,
    /// Nivel de anidación dentro del índice (0 = primer nivel).
    pub depth: usize,
}

pub struct ParsedEpub {
    pub title: String,
    pub creator: Option<String>,
    pub language: Option<String>,
    pub identifier: Option<String>,
    pub version: String,
    pub chapters: Vec<EpubChapter>,
    /// Entradas del índice en el orden del libro.
    pub toc: Vec<TocEntry>,
    pub warnings: Vec<String>,
}

pub fn read_epub_package(path: &Path) -> Result<ParsedEpub> {
    let file = File::open(path)
        .with_context(|| format!("no se pudo abrir el EPUB {}", path.display()))?;
    let mut archive = ZipArchive::new(file)
        .with_context(|| format!("{} no es un ZIP/EPUB válido", path.display()))?;

    let container = read_entry(&mut archive, "META-INF/container.xml")?;
    let rootfile = parse_container(&container)?;
    let opf = read_entry(&mut archive, &rootfile)?;
    let package = parse_package(&opf, &rootfile)?;

    let mut toc_titles: HashMap<String, String> = HashMap::new();
    let mut toc_order: Vec<TocEntry> = Vec::new();
    if let Some(ncx_path) = &package.ncx_path {
        if let Ok(ncx_xml) = read_entry(&mut archive, ncx_path) {
            parse_ncx_titles(&ncx_xml, ncx_path, &mut toc_titles, &mut toc_order);
        }
    }
    if let Some(nav_path) = &package.nav_path {
        if let Ok(nav_xhtml) = read_entry(&mut archive, nav_path) {
            parse_nav_titles(&nav_xhtml, nav_path, &mut toc_titles, &mut toc_order);
        }
    }

    let readable_spine: Vec<(usize, String)> = package
        .spine
        .iter()
        .enumerate()
        .filter(|(_, item)| {
            matches!(
                item.media_type.as_str(),
                "application/xhtml+xml" | "text/html"
            )
        })
        .map(|(idx, item)| (idx, resolve_path(&package.opf_dir, &item.href)))
        .collect();

    let mut spine_path_to_chapter_idx: HashMap<String, usize> = HashMap::new();
    for (chapter_idx, (_, full_path)) in readable_spine.iter().enumerate() {
        spine_path_to_chapter_idx.insert(full_path.clone(), chapter_idx);
    }

    let mut chapters = Vec::new();
    let mut warnings = Vec::new();
    for (chapter_idx, (spine_idx, full_path)) in readable_spine.iter().enumerate() {
        match read_entry(&mut archive, full_path) {
            Ok(xhtml) => {
                let toc_title = toc_titles.get(full_path).cloned();
                let extracted = extract_title(&xhtml, &package.title);
                let title = match (toc_title, extracted) {
                    (Some(t_toc), Some(t_ext)) => {
                        if t_toc.chars().all(|c| c.is_ascii_digit())
                            && !t_ext.chars().all(|c| c.is_ascii_digit())
                        {
                            format!("{t_toc}. {t_ext}")
                        } else {
                            t_toc
                        }
                    }
                    (Some(t_toc), None) => t_toc,
                    (None, Some(t_ext)) => t_ext,
                    (None, None) => format!("Capítulo {}", chapters.len() + 1),
                };

                let raw_body = extract_body(&xhtml);
                let enhanced_body = enhance_epub_body(
                    &raw_body,
                    full_path,
                    &spine_path_to_chapter_idx,
                    chapter_idx,
                );
                let dedup_body = strip_duplicate_heading(&enhanced_body, &title);
                let (tagged_body, _) = tag_scriptures(&dedup_body);
                let html = sanitize_epub(&tagged_body);

                chapters.push(EpubChapter {
                    spine: chapter_idx as i64,
                    title,
                    href: full_path.clone(),
                    html,
                });
            }
            Err(error) => warnings.push(format!(
                "No se pudo leer el capítulo {} ({}): {error:#}",
                spine_idx + 1,
                full_path
            )),
        }
    }

    if chapters.is_empty() {
        return Err(anyhow!(
            "El EPUB no contiene capítulos XHTML legibles en su spine"
        ));
    }

    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "libro.epub".to_string());
    let fallback_title = file_name
        .trim_end_matches(".epub")
        .trim_end_matches(".azw3")
        .trim_end_matches(".mobi")
        .to_string();
    let title = if package.title.trim().is_empty() {
        fallback_title
    } else {
        package.title.clone()
    };

    Ok(ParsedEpub {
        title,
        creator: package.creator,
        language: package.language,
        identifier: package.identifier,
        version: package.version,
        chapters,
        toc: toc_order,
        warnings,
    })
}

/// Posición del bloque que lleva el ancla `fragment` dentro del HTML.
fn anchor_position(html: &str, fragment: &str) -> Option<usize> {
    if fragment.is_empty() {
        return Some(0);
    }
    let patterns = [
        format!("id=\"{fragment}\""),
        format!("id='{fragment}'"),
        format!("name=\"{fragment}\""),
        format!("name='{fragment}'"),
    ];
    let mut best: Option<usize> = None;
    for pattern in &patterns {
        if let Some(position) = html.find(pattern) {
            if let Some(tag_start) = html[..position].rfind('<') {
                best = Some(best.map_or(tag_start, |current: usize| current.min(tag_start)));
            }
        }
    }
    best
}

fn push_chapter(chapters: &mut Vec<EpubChapter>, title: &mut Option<String>, html: &mut String) {
    if html.trim().is_empty() {
        html.clear();
        return;
    }
    let index = chapters.len() as i64;
    let name = title
        .take()
        .unwrap_or_else(|| format!("Capítulo {}", index + 1));
    chapters.push(EpubChapter {
        spine: index,
        title: name,
        href: format!("pbb://chapter/{index}"),
        html: std::mem::take(html),
    });
}

/// Construye los capítulos siguiendo el índice del EPUB: agrupa los documentos
/// del spine y, cuando varios capítulos comparten archivo, corta en sus anclas.
pub fn chapters_from_toc(parsed: &ParsedEpub) -> Vec<EpubChapter> {
    let in_spine: Vec<&TocEntry> = parsed
        .toc
        .iter()
        .filter(|entry| {
            parsed
                .chapters
                .iter()
                .any(|chapter| chapter.href == entry.path)
        })
        .collect();
    if in_spine.len() < 2 {
        return parsed.chapters.clone();
    }

    // Los títulos de capítulo son el nivel alto del índice; los niveles
    // inferiores (subsecciones) no deben convertirse en capítulos.
    let min_depth = in_spine.iter().map(|entry| entry.depth).min().unwrap_or(0);
    let min_count = in_spine
        .iter()
        .filter(|entry| entry.depth == min_depth)
        .count();
    let chapter_depth = if min_count == 1 && in_spine.len() > 1 {
        min_depth + 1
    } else {
        min_depth
    };

    let mut by_file: HashMap<&str, Vec<&TocEntry>> = HashMap::new();
    let mut usable = 0usize;
    for entry in &in_spine {
        if entry.depth != chapter_depth {
            continue;
        }
        by_file.entry(entry.path.as_str()).or_default().push(entry);
        usable += 1;
    }
    if usable < 2 {
        return parsed.chapters.clone();
    }

    let mut chapters: Vec<EpubChapter> = Vec::new();
    let mut current_title: Option<String> = None;
    let mut current_html = String::new();
    let mut located = 0usize;

    for file in &parsed.chapters {
        let entries = by_file.get(file.href.as_str()).cloned().unwrap_or_default();
        if entries.is_empty() {
            if current_title.is_none() {
                current_title = Some(file.title.clone());
            }
            current_html.push_str(&file.html);
            continue;
        }

        let mut points: Vec<(usize, String)> = entries
            .iter()
            .filter_map(|entry| {
                anchor_position(&file.html, &entry.fragment).map(|position| {
                    (position, entry.title.clone())
                })
            })
            .collect();
        points.sort_by_key(|(position, _)| *position);
        points.dedup_by_key(|(position, _)| *position);

        if points.is_empty() {
            if current_title.is_none() {
                current_title = Some(file.title.clone());
            }
            current_html.push_str(&file.html);
            continue;
        }
        located += points.len();

        if points[0].0 > 0 {
            if current_title.is_none() {
                current_title = Some(file.title.clone());
            }
            current_html.push_str(&file.html[..points[0].0]);
        }

        for (position, (start, title)) in points.iter().enumerate() {
            push_chapter(&mut chapters, &mut current_title, &mut current_html);
            let end = points
                .get(position + 1)
                .map(|(next, _)| *next)
                .unwrap_or(file.html.len());
            current_title = Some(if title.trim().is_empty() {
                file.title.clone()
            } else {
                title.trim().to_string()
            });
            current_html = file.html[*start..end].to_string();
        }
    }
    push_chapter(&mut chapters, &mut current_title, &mut current_html);

    if located < 2 || chapters.is_empty() {
        parsed.chapters.clone()
    } else {
        chapters
    }
}

/// Capítulos que deben guardarse al importar.
pub fn chapters_for_import(parsed: &ParsedEpub) -> Vec<EpubChapter> {
    chapters_from_toc(parsed)
}

pub fn import_epub(catalog: &mut Catalog, path: &Path) -> Result<ImportReport> {
    let parsed = read_epub_package(path)?;
    let chapters = chapters_for_import(&parsed);
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "libro.epub".to_string());
    let abbreviation = parsed.title.chars().take(28).collect::<String>();
    let mut resource = Resource {
        id: format!(
            "epub:{}",
            file_name.to_ascii_lowercase().replace(' ', "_")
        ),
        kind: ResourceKind::Book,
        title: parsed.title.clone(),
        abbreviation,
        language: parsed.language.clone().unwrap_or_default(),
        source_format: "epub".to_string(),
        source_path: path.to_string_lossy().to_string(),
        verse_count: 0,
        entry_count: chapters.len() as i64,
        imported_at: now_epoch(),
        search_priority: 0,
        cloud_synced: false,
        metadata: json!({
            "title": parsed.title,
            "creator": parsed.creator,
            "language": parsed.language,
            "identifier": parsed.identifier,
            "epubVersion": parsed.version,
            "chapterCount": chapters.len(),
                "structureVersion": 2,
        }),
    };

    catalog.upsert_resource(&resource)?;
    catalog.replace_epub_chapters(&resource.id, &chapters)?;
    resource.entry_count = chapters.len() as i64;
    catalog.upsert_resource(&resource)?;

    let _ = crate::indexer::index_resource(catalog.connection_mut(), &resource.id);
    Ok(ImportReport {
        resource,
        warnings: parsed.warnings,
    })
}

fn read_entry(archive: &mut ZipArchive<File>, name: &str) -> Result<String> {
    let normalized = name.trim_start_matches('/');
    let mut entry = archive
        .by_name(normalized)
        .with_context(|| format!("entrada no encontrada en el EPUB: {normalized}"))?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn parse_container(xml: &str) -> Result<String> {
    let document = Document::parse(xml).context("container.xml mal formado")?;
    let rootfile = document
        .descendants()
        .find(|node| node.is_element() && node.tag_name().name() == "rootfile")
        .ok_or_else(|| anyhow!("container.xml no declara un rootfile"))?;
    rootfile
        .attribute("full-path")
        .map(|value| value.to_string())
        .ok_or_else(|| anyhow!("rootfile sin atributo full-path"))
}

fn parse_package(xml: &str, rootfile: &str) -> Result<Package> {
    let document = Document::parse(xml).context("el archivo OPF del EPUB está mal formado")?;
    let package_node = document
        .descendants()
        .find(|node| node.is_element() && node.tag_name().name() == "package")
        .ok_or_else(|| anyhow!("el OPF no contiene un elemento package"))?;

    let metadata = document
        .descendants()
        .find(|node| node.is_element() && node.tag_name().name() == "metadata");
    let mut title = String::new();
    let mut creator = None;
    let mut language = None;
    let mut identifier = None;
    if let Some(metadata) = metadata {
        for child in metadata.children().filter(|node| node.is_element()) {
            let value = child.text().unwrap_or_default().trim().to_string();
            if value.is_empty() {
                continue;
            }
            match child.tag_name().name() {
                "title" if title.is_none_or_empty() => title = value,
                "creator" if creator.is_none() => creator = Some(value),
                "language" if language.is_none() => language = Some(value),
                "identifier" if identifier.is_none() => identifier = Some(value),
                _ => {}
            }
        }
    }

    let opf_dir = rootfile
        .rsplit_once('/')
        .map(|(directory, _)| directory.to_string())
        .unwrap_or_default();

    let mut manifest = HashMap::new();
    let mut ncx_path = None;
    let mut nav_path = None;

    if let Some(manifest_node) = document
        .descendants()
        .find(|node| node.is_element() && node.tag_name().name() == "manifest")
    {
        for item in manifest_node.children().filter(|node| node.is_element()) {
            if item.tag_name().name() != "item" {
                continue;
            }
            let (Some(id), Some(href), Some(media_type)) = (
                item.attribute("id"),
                item.attribute("href"),
                item.attribute("media-type"),
            ) else {
                continue;
            };
            let properties = item.attribute("properties").unwrap_or_default().to_string();
            if media_type == "application/x-dtbncx+xml" || id.eq_ignore_ascii_case("ncx") {
                ncx_path = Some(resolve_path(&opf_dir, href));
            }
            if properties.split_whitespace().any(|p| p == "nav") {
                nav_path = Some(resolve_path(&opf_dir, href));
            }
            manifest.insert(
                id.to_string(),
                ManifestItem {
                    href: href.to_string(),
                    media_type: media_type.to_string(),
                    properties,
                },
            );
        }
    }

    let mut spine = Vec::new();
    if let Some(spine_node) = document
        .descendants()
        .find(|node| node.is_element() && node.tag_name().name() == "spine")
    {
        if ncx_path.is_none() {
            if let Some(toc_id) = spine_node.attribute("toc") {
                if let Some(ncx_item) = manifest.get(toc_id) {
                    ncx_path = Some(resolve_path(&opf_dir, &ncx_item.href));
                }
            }
        }
        for itemref in spine_node.children().filter(|node| node.is_element()) {
            if itemref.tag_name().name() != "itemref" {
                continue;
            }
            let Some(idref) = itemref.attribute("idref") else {
                continue;
            };
            if let Some(item) = manifest.get(idref) {
                spine.push(item.clone());
            }
        }
    }

    Ok(Package {
        title,
        creator,
        language,
        identifier,
        version: package_node
            .attribute("version")
            .unwrap_or("desconocida")
            .to_string(),
        opf_dir,
        ncx_path,
        nav_path,
        spine,
    })
}

trait StrExt {
    fn is_none_or_empty(&self) -> bool;
}

impl StrExt for String {
    fn is_none_or_empty(&self) -> bool {
        self.trim().is_empty()
    }
}

fn parse_ncx_titles(
    ncx_xml: &str,
    ncx_path: &str,
    toc_titles: &mut HashMap<String, String>,
    toc_order: &mut Vec<TocEntry>,
) {
    let Ok(doc) = Document::parse(ncx_xml) else {
        return;
    };
    let ncx_dir = ncx_path
        .rsplit_once('/')
        .map(|(d, _)| d.to_string())
        .unwrap_or_default();

    for nav_point in doc
        .descendants()
        .filter(|n| n.is_element() && n.tag_name().name() == "navPoint")
    {
        let label = nav_point
            .children()
            .find(|n| n.is_element() && n.tag_name().name() == "navLabel")
            .and_then(|nl| {
                nl.children()
                    .find(|n| n.is_element() && n.tag_name().name() == "text")
            })
            .and_then(|t| t.text())
            .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
            .unwrap_or_default();
        let src = nav_point
            .children()
            .find(|n| n.is_element() && n.tag_name().name() == "content")
            .and_then(|c| c.attribute("src"))
            .unwrap_or_default();

        if label.is_empty() || src.is_empty() {
            continue;
        }
        let (raw_path, fragment) = split_href(src);
        let resolved_file = resolve_path(&ncx_dir, &raw_path);
        let depth = nav_point
            .ancestors()
            .filter(|node| node.is_element() && node.tag_name().name() == "navPoint")
            .count();
        toc_titles
            .entry(resolved_file.clone())
            .or_insert_with(|| label.clone());
        toc_order.push(TocEntry {
            path: resolved_file,
            fragment,
            title: label,
            depth,
        });
    }
}

fn parse_nav_titles(
    nav_xhtml: &str,
    nav_path: &str,
    toc_titles: &mut HashMap<String, String>,
    toc_order: &mut Vec<TocEntry>,
) {
    let nav_dir = nav_path
        .rsplit_once('/')
        .map(|(d, _)| d.to_string())
        .unwrap_or_default();
    let token_re = Regex::new(
        r#"(?is)<ul\b[^>]*>|</ul>|<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>"#,
    )
    .unwrap();
    let mut list_depth: usize = 0;
    for cap in token_re.captures_iter(nav_xhtml) {
        let whole = cap.get(0).map(|m| m.as_str()).unwrap_or_default();
        if whole.to_ascii_lowercase().starts_with("<ul") {
            list_depth += 1;
            continue;
        }
        if whole.eq_ignore_ascii_case("</ul>") {
            list_depth = list_depth.saturating_sub(1);
            continue;
        }
        let depth = list_depth.saturating_sub(1);
        let Some(href) = cap.get(1).map(|m| m.as_str()) else {
            continue;
        };
        let raw_label = decode_entities(&TAGS.replace_all(&cap[2], " "));
        let label = raw_label.split_whitespace().collect::<Vec<_>>().join(" ");
        if label.is_empty() || href.starts_with("http://") || href.starts_with("https://") {
            continue;
        }
        let (raw_path, fragment) = split_href(href);
        let resolved_file = resolve_path(&nav_dir, &raw_path);
        toc_titles
            .entry(resolved_file.clone())
            .or_insert_with(|| label.clone());
        toc_order.push(TocEntry {
            path: resolved_file,
            fragment,
            title: label,
            depth,
        });
    }
}

fn split_href(href: &str) -> (String, String) {
    match href.split_once('#') {
        Some((path, fragment)) => (path.to_string(), fragment.to_string()),
        None => (href.to_string(), String::new()),
    }
}

fn resolve_path(base: &str, href: &str) -> String {
    let href = href.split('#').next().unwrap_or(href);
    let href = href.split('?').next().unwrap_or(href);
    let decoded = percent_decode_str(href).decode_utf8_lossy();
    let combined = if decoded.starts_with('/') {
        decoded.trim_start_matches('/').to_string()
    } else if base.is_empty() {
        decoded.to_string()
    } else {
        format!("{base}/{decoded}")
    };
    let mut parts = Vec::new();
    for part in combined.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}

fn extract_body(xhtml: &str) -> String {
    BODY.captures(xhtml)
        .map(|captures| captures[1].to_string())
        .unwrap_or_else(|| xhtml.to_string())
}

fn classify_implicit_heading_class(class_attr: &str) -> Option<u8> {
    for token in class_attr.split_whitespace() {
        let lower = token.to_ascii_lowercase();
        match lower.as_str() {
            "ct" | "ot" | "pt" | "chapter-title" | "part-title" | "title" | "heading1"
            | "h1-title" => return Some(1),
            "cn" | "chapter-number" | "part-number" => return Some(2),
            "cst" | "h1" | "section-title" | "chapter-subtitle" | "subtitle" | "heading2" => {
                return Some(2)
            }
            "h2" | "subsection-title" | "subhead" | "heading3" => return Some(3),
            "h3" | "h4" | "heading4" => return Some(4),
            _ => {}
        }
    }
    None
}

fn enhance_epub_body(
    body: &str,
    chapter_path: &str,
    spine_map: &HashMap<String, usize>,
    chapter_idx: usize,
) -> String {
    let chapter_dir = chapter_path
        .rsplit_once('/')
        .map(|(d, _)| d.to_string())
        .unwrap_or_default();

    let mut sec_counter: usize = 0;

    // 1. Promote <p class="CT|OT|CST|H1|H2|H3..."> to semantic <h1>..<h4> with id
    let p_tag_re =
        Regex::new(r#"(?is)<p(\b[^>]*?\bclass\s*=\s*["']([^"']*)["'][^>]*)>(.*?)</p>"#).unwrap();
    let promoted = p_tag_re
        .replace_all(body, |caps: &regex::Captures<'_>| {
            let attrs = &caps[1];
            let class_val = &caps[2];
            let inner = &caps[3];
            let plain = decode_entities(&TAGS.replace_all(inner, " "));
            let trimmed = plain.split_whitespace().collect::<Vec<_>>().join(" ");
            if trimmed.is_empty() {
                return caps[0].to_string();
            }
            if let Some(level) = classify_implicit_heading_class(class_val) {
                let tag = match level {
                    1 => "h1",
                    2 => "h2",
                    3 => "h3",
                    _ => "h4",
                };
                if ID_ATTR_RE.is_match(attrs) {
                    format!("<{tag}{attrs}>{inner}</{tag}>")
                } else {
                    sec_counter += 1;
                    format!(
                        "<{tag} id=\"sec-epub-{chapter_idx}-{sec_counter}\"{attrs}>{inner}</{tag}>"
                    )
                }
            } else {
                caps[0].to_string()
            }
        })
        .into_owned();

    // 2. Ensure existing <h1..h4> tags have an id attribute for interactive Secciones navigation
    let with_heading_ids = H_TAG_RE
        .replace_all(&promoted, |caps: &regex::Captures<'_>| {
            let tag = &caps[1].to_ascii_lowercase();
            let attrs = &caps[2];
            let inner = &caps[3];
            if ID_ATTR_RE.is_match(attrs) {
                caps[0].to_string()
            } else {
                sec_counter += 1;
                format!("<{tag} id=\"sec-epub-{chapter_idx}-{sec_counter}\"{attrs}>{inner}</{tag}>")
            }
        })
        .into_owned();

    // 3. Resolve internal <a href="..."> links across spine chapters and anchors
    A_TAG_RE
        .replace_all(&with_heading_ids, |caps: &regex::Captures<'_>| {
            let full_attrs = &caps[1];
            let href = caps[2].trim();
            if href.is_empty()
                || href.starts_with("http://")
                || href.starts_with("https://")
                || href.starts_with("mailto:")
                || full_attrs.contains("data-toc-spine")
            {
                return caps[0].to_string();
            }
            let (file_part, frag_part) = match href.split_once('#') {
                Some((f, frag)) => (f, Some(frag)),
                None => (href, None),
            };
            let target_spine = if file_part.is_empty() {
                Some(chapter_idx)
            } else {
                let resolved = resolve_path(&chapter_dir, file_part);
                spine_map.get(&resolved).copied()
            };

            if let Some(spine_idx) = target_spine {
                let anchor_attr = frag_part
                    .filter(|f| !f.is_empty())
                    .map(|f| format!(r#" data-toc-anchor="{}""#, escape_attr(f)))
                    .unwrap_or_default();
                format!(
                    r#"<a class="book-toc-link" data-toc-spine="{spine_idx}"{anchor_attr}{full_attrs}>"#
                )
            } else {
                caps[0].to_string()
            }
        })
        .into_owned()
}

fn strip_duplicate_heading(body: &str, title: &str) -> String {
    let Some(captures) = FIRST_HEADING.captures(body) else {
        return body.to_string();
    };
    let heading = decode_entities(&TAGS.replace_all(&captures[1], " "));
    let normalize = |value: &str| {
        value
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };
    if normalize(&heading) == normalize(title) {
        FIRST_HEADING.replace(body, "").to_string()
    } else {
        body.to_string()
    }
}

fn extract_title(xhtml: &str, package_title: &str) -> Option<String> {
    let clean = |raw: &str| {
        let text = decode_entities(&TAGS.replace_all(raw, " "));
        text.split_whitespace().collect::<Vec<_>>().join(" ")
    };

    // 1. Check semantic <h1>..<h3>
    if let Some(caps) = HEADING.captures(xhtml) {
        let h = clean(&caps[1]);
        if !h.is_empty() && !h.eq_ignore_ascii_case("unknown") {
            return Some(h);
        }
    }

    // 2. Check implicit title classes (<p class="CT|OT|CN|H1...">)
    let mut chapter_num: Option<String> = None;
    let mut chapter_title: Option<String> = None;
    for caps in IMPLICIT_TITLE_P.captures_iter(xhtml) {
        let class_attr = &caps[1];
        let text = clean(&caps[2]);
        if text.is_empty() {
            continue;
        }
        for token in class_attr.split_whitespace() {
            let lower = token.to_ascii_lowercase();
            match lower.as_str() {
                "cn" | "chapter-number" | "part-number" if chapter_num.is_none() => {
                    chapter_num = Some(text.clone());
                }
                "ct" | "ot" | "pt" | "chapter-title" | "part-title" | "h1"
                    if chapter_title.is_none() =>
                {
                    chapter_title = Some(text.clone());
                }
                _ => {}
            }
        }
        if chapter_title.is_some() {
            break;
        }
    }
    match (chapter_num, chapter_title) {
        (Some(num), Some(t)) => {
            let sep = if num.chars().all(|c| c.is_ascii_digit()) {
                ". "
            } else {
                " "
            };
            return Some(format!("{num}{sep}{t}"));
        }
        (None, Some(t)) => return Some(t),
        (Some(num), None) => return Some(num),
        (None, None) => {}
    }

    // 3. Fallback to <title> only if it does not merely repeat the book's package title
    if let Some(caps) = TITLE.captures(xhtml) {
        let t = clean(&caps[1]);
        let pkg_norm = clean(package_title);
        if !t.is_empty()
            && !t.eq_ignore_ascii_case("unknown")
            && (pkg_norm.is_empty() || !t.eq_ignore_ascii_case(&pkg_norm))
        {
            return Some(t);
        }
    }
    None
}

fn tag_scriptures(html: &str) -> (String, usize) {
    let mut result = String::with_capacity(html.len());
    let mut text = String::new();
    let mut in_tag = false;
    let mut count = 0;

    let flush = |text: &mut String, result: &mut String, count: &mut usize| {
        if text.is_empty() {
            return;
        }
        let mut last = 0;
        for found in SCRIPTURE_RE.find_iter(text) {
            result.push_str(&text[last..found.start()]);
            result.push_str("<span class=\"scripture-ref\" data-ref=\"");
            result.push_str(&escape_attr(found.as_str()));
            result.push_str("\">");
            result.push_str(found.as_str());
            result.push_str("</span>");
            last = found.end();
            *count += 1;
        }
        result.push_str(&text[last..]);
        text.clear();
    };

    for character in html.chars() {
        if character == '<' {
            flush(&mut text, &mut result, &mut count);
            in_tag = true;
            result.push(character);
        } else if character == '>' {
            in_tag = false;
            result.push(character);
        } else if in_tag {
            result.push(character);
        } else {
            text.push(character);
        }
    }
    flush(&mut text, &mut result, &mut count);
    (result, count)
}

fn escape_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn sanitize_epub(html: &str) -> String {
    let mut builder = ammonia::Builder::default();
    builder
        .add_tags([
            "span", "div", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody",
            "tr", "td", "th", "figure", "figcaption", "a",
        ])
        .add_generic_attributes([
            "class",
            "id",
            "name",
            "data-toc-anchor",
            "data-toc-spine",
            "data-ref",
        ])
        .add_tag_attributes("a", ["href"])
        .rm_tags([
            "script", "style", "iframe", "object", "embed", "img", "svg", "video", "audio",
            "form", "input", "button", "canvas",
        ])
        .link_rel(Some("noopener noreferrer"));
    builder.clean(html).to_string()
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}
