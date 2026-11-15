use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use anyhow::{anyhow, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::db::Catalog;
use crate::model::EpubChapter;

const VOID_TAGS: &[&str] = &[
    "br", "img", "hr", "meta", "link", "input", "source", "col", "area", "base", "embed",
    "param", "track", "wbr",
];

static HEADING_HINT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^\s*(?:cap[íi]tulo|chapter|parte|part|§|lecci[óo]n|lesson|\d+\.)")
        .expect("regex válida")
});
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<[^>]+>").expect("regex"));
static WS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").expect("regex"));

#[derive(Clone)]
struct Block {
    tag: String,
    html: String,
    text: String,
}

fn parse_tag(source: &str) -> Option<(String, bool, bool, usize)> {
    let bytes = source.as_bytes();
    if bytes.first() != Some(&b'<') {
        return None;
    }
    let mut i = 1;
    let closing = bytes.get(i) == Some(&b'/');
    if closing {
        i += 1;
    }
    let start = i;
    while i < bytes.len()
        && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b':' || bytes[i] == b'-')
    {
        i += 1;
    }
    if i == start {
        return None;
    }
    let name = source[start..i].to_ascii_lowercase();
    let end = i + source[i..].find('>')?;
    let self_closing = source[..end].trim_end().ends_with('/');
    Some((name, closing, self_closing, end + 1))
}

fn find_matching_close(html: &str, mut index: usize, name: &str) -> Option<usize> {
    let mut depth = 1usize;
    while index < html.len() {
        let offset = html[index..].find('<')?;
        let position = index + offset;
        if html[position..].starts_with("<!--") {
            let end = html[position..].find("-->")?;
            index = position + end + 3;
            continue;
        }
        let Some((tag, closing, self_closing, length)) = parse_tag(&html[position..]) else {
            index = position + 1;
            continue;
        };
        if tag == name {
            if closing {
                depth -= 1;
                if depth == 0 {
                    return Some(position + length);
                }
            } else if !self_closing && !VOID_TAGS.contains(&tag.as_str()) {
                depth += 1;
            }
        }
        index = position + length;
    }
    None
}

fn text_of(html: &str) -> String {
    let plain = TAG_RE.replace_all(html, " ");
    let decoded = plain
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    WS_RE.replace_all(decoded.trim(), " ").to_string()
}

const CONTAINER_TAGS: &[&str] = &[
    "div", "section", "article", "main", "body", "header", "footer", "aside",
];

static BLOCK_CHILD_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)<(?:p|h[1-6]|div|blockquote|ul|ol|table|section|article|figure|pre)\b")
        .expect("regex")
});

fn flatten(html: &str) -> Vec<Block> {
    let mut blocks = Vec::new();
    flatten_into(html, &mut blocks);
    blocks
}

fn flatten_into(html: &str, blocks: &mut Vec<Block>) {
    let mut index = 0usize;
    while index < html.len() {
        let Some(lt) = html[index..].find('<').map(|position| index + position) else {
            let tail = html[index..].trim();
            if !tail.is_empty() {
                blocks.push(Block {
                    tag: "text".to_string(),
                    html: html[index..].to_string(),
                    text: text_of(tail),
                });
            }
            break;
        };
        if lt > index {
            let chunk = &html[index..lt];
            if !chunk.trim().is_empty() {
                blocks.push(Block {
                    tag: "text".to_string(),
                    html: chunk.to_string(),
                    text: text_of(chunk),
                });
            }
        }
        if html[lt..].starts_with("<!--") {
            match html[lt..].find("-->") {
                Some(end) => {
                    index = lt + end + 3;
                    continue;
                }
                None => break,
            }
        }
        let Some((tag, closing, self_closing, length)) = parse_tag(&html[lt..]) else {
            index = lt + 1;
            continue;
        };
        if closing {
            index = lt + length;
            continue;
        }
        if self_closing || VOID_TAGS.contains(&tag.as_str()) {
            blocks.push(Block {
                tag,
                html: html[lt..lt + length].to_string(),
                text: String::new(),
            });
            index = lt + length;
            continue;
        }
        match find_matching_close(html, lt + length, &tag) {
            Some(end) => {
                let block_html = &html[lt..end];
                let inner_start = lt + length;
                let inner_end = block_html
                    .rfind("</")
                    .map(|position| lt + position)
                    .unwrap_or(end);
                let inner = &html[inner_start..inner_end];
                let is_container = CONTAINER_TAGS.contains(&tag.as_str())
                    && BLOCK_CHILD_RE.is_match(inner);
                if is_container {
                    flatten_into(inner, blocks);
                } else {
                    blocks.push(Block {
                        tag,
                        html: block_html.to_string(),
                        text: text_of(block_html),
                    });
                }
                index = end;
            }
            None => {
                index = lt + length;
            }
        }
    }
}

fn is_candidate(block: &Block) -> bool {
    if block.tag.len() == 2 && block.tag.starts_with('h') {
        return true;
    }
    let text = block.text.trim();
    if text.len() < 2 || text.len() > 140 {
        return false;
    }
    if HEADING_HINT.is_match(text) {
        return true;
    }
    let letters: Vec<char> = text.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.len() >= 6 {
        let uppercase = letters.iter().filter(|c| c.is_uppercase()).count();
        if uppercase as f32 / letters.len() as f32 > 0.8 {
            return true;
        }
    }
    false
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DigestBlock {
    pub index: usize,
    pub tag: String,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDigest {
    pub resource_id: String,
    pub title: String,
    pub block_count: usize,
    pub candidates: Vec<DigestBlock>,
    pub digest: String,
    pub estimated_tokens: usize,
}

pub fn digest(catalog: &Catalog, resource_id: &str) -> Result<BookDigest> {
    let resource = catalog
        .get_resource(resource_id)?
        .ok_or_else(|| anyhow!("No se encontró el libro."))?;
    let chapters = catalog.epub_chapters_full(resource_id)?;

    let mut blocks = Vec::new();
    for chapter in &chapters {
        blocks.extend(flatten(&chapter.html));
    }

    let mut candidates = Vec::new();
    for (index, block) in blocks.iter().enumerate() {
        if !is_candidate(block) {
            continue;
        }
        candidates.push(DigestBlock {
            index,
            tag: block.tag.clone(),
            text: block.text.chars().take(120).collect(),
        });
        if candidates.len() >= 1200 {
            break;
        }
    }

    let mut digest = format!(
        "Libro: {}\nCapítulos actuales: {}\nBloques totales: {}\n\nCandidatos (índice · etiqueta · texto):\n",
        resource.title,
        chapters.len(),
        blocks.len()
    );
    for candidate in &candidates {
        digest.push_str(&format!(
            "{} · {} · {}\n",
            candidate.index, candidate.tag, candidate.text
        ));
    }
    let estimated_tokens = digest.chars().count() / 4 + 400;

    Ok(BookDigest {
        resource_id: resource.id,
        title: resource.title,
        block_count: blocks.len(),
        candidates,
        digest,
        estimated_tokens,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanChapter {
    pub block: usize,
    #[serde(default)]
    pub title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanHeading {
    pub block: usize,
    pub level: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypesetPlan {
    #[serde(default)]
    pub chapters: Vec<PlanChapter>,
    #[serde(default)]
    pub headings: Vec<PlanHeading>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    pub chapters: usize,
    pub backup_path: String,
}

fn strip_outer_tag(html: &str) -> String {
    let Some(start) = html.find('>') else {
        return html.to_string();
    };
    match html.rfind("</") {
        Some(end) if end > start => html[start + 1..end].to_string(),
        _ => html[start + 1..].to_string(),
    }
}

fn block_markup(block: &Block, level: Option<u8>) -> String {
    match level {
        Some(level) if (1..=4).contains(&level) => {
            let inner = strip_outer_tag(&block.html);
            format!("<h{level}>{inner}</h{level}>")
        }
        _ => block.html.clone(),
    }
}

fn backup_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".local/share/com.teoamoxtli.desktop/backups");
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("com.teoamoxtli.desktop/backups");
    }
    std::env::temp_dir().join("minelly-backups")
}

fn write_backup(resource_id: &str, chapters: &[EpubChapter]) -> Result<PathBuf> {
    let directory = backup_dir();
    std::fs::create_dir_all(&directory)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let path = directory.join(format!("typeset-{}-{}.json", stamp, resource_id.len()));
    let payload = serde_json::json!({
        "resourceId": resource_id,
        "chapters": chapters,
    });
    std::fs::write(&path, serde_json::to_string(&payload)?)?;
    Ok(path)
}

pub fn apply(catalog: &mut Catalog, resource_id: &str, plan: &TypesetPlan) -> Result<ApplyReport> {
    let resource = catalog
        .get_resource(resource_id)?
        .ok_or_else(|| anyhow!("No se encontró el libro."))?;
    if plan.chapters.len() < 2 {
        return Err(anyhow!("El plan debe proponer al menos dos capítulos."));
    }

    let current = catalog.epub_chapters_full(resource_id)?;
    let mut blocks = Vec::new();
    for chapter in &current {
        blocks.extend(flatten(&chapter.html));
    }
    if blocks.is_empty() {
        return Err(anyhow!("El libro no tiene contenido que maquetar."));
    }

    let mut starts: Vec<(usize, String)> = plan
        .chapters
        .iter()
        .filter(|chapter| chapter.block < blocks.len())
        .map(|chapter| (chapter.block, chapter.title.trim().to_string()))
        .collect();
    starts.sort_by_key(|(block, _)| *block);
    starts.dedup_by_key(|(block, _)| *block);

    if starts.len() < 2 {
        return Err(anyhow!("Los índices del plan no coinciden con el libro."));
    }

    let mut levels = std::collections::HashMap::new();
    for heading in &plan.headings {
        if heading.block < blocks.len() && (1..=4).contains(&heading.level) {
            levels.insert(heading.block, heading.level);
        }
    }

    let mut chapters: Vec<EpubChapter> = Vec::new();
    if starts[0].0 > 0 {
        let html = blocks[..starts[0].0]
            .iter()
            .map(|block| block.html.as_str())
            .collect::<String>();
        if !html.trim().is_empty() {
            let index = chapters.len() as i64;
            chapters.push(EpubChapter {
                spine: index,
                title: "Portada y créditos".to_string(),
                href: format!("pbb://chapter/{index}"),
                html,
            });
        }
    }

    for (position, (start, title)) in starts.iter().enumerate() {
        let end = starts
            .get(position + 1)
            .map(|(block, _)| *block)
            .unwrap_or(blocks.len());
        if end <= *start {
            continue;
        }
        let mut html = String::new();
        for index in *start..end {
            html.push_str(&block_markup(&blocks[index], levels.get(&index).copied()));
        }
        if html.trim().is_empty() {
            continue;
        }
        let fallback = blocks
            .get(*start)
            .map(|block| block.text.chars().take(90).collect::<String>())
            .unwrap_or_default();
        let name = if title.is_empty() {
            fallback
        } else {
            title.clone()
        };
        let spine = chapters.len() as i64;
        chapters.push(EpubChapter {
            spine,
            title: name,
            href: format!("pbb://chapter/{spine}"),
            html,
        });
    }

    if chapters.is_empty() {
        return Err(anyhow!("El plan no generó capítulos válidos."));
    }

    let backup = write_backup(resource_id, &current)?;
    crate::library::store_chapters(catalog, &resource, &chapters)?;

    Ok(ApplyReport {
        chapters: chapters.len(),
        backup_path: backup.to_string_lossy().to_string(),
    })
}

pub fn undo(catalog: &mut Catalog, backup_path: &str) -> Result<usize> {
    let path = Path::new(backup_path);
    if !path.exists() {
        return Err(anyhow!("No se encuentra la copia de seguridad."));
    }
    let payload: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    let resource_id = payload
        .get("resourceId")
        .and_then(|value| value.as_str())
        .ok_or_else(|| anyhow!("La copia no indica el libro."))?;
    let chapters: Vec<EpubChapter> = serde_json::from_value(
        payload
            .get("chapters")
            .cloned()
            .ok_or_else(|| anyhow!("La copia no contiene capítulos."))?,
    )?;
    let resource = catalog
        .get_resource(resource_id)?
        .ok_or_else(|| anyhow!("El libro de la copia ya no existe."))?;
    crate::library::store_chapters(catalog, &resource, &chapters)?;
    Ok(chapters.len())
}
