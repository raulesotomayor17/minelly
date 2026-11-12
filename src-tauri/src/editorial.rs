use anyhow::Result;
use regex::{Captures, Regex};
use rusqlite::Connection;

pub fn normalize_editorial_html(raw: &str) -> String {
    let broken = Regex::new(r"(?i)(?:^|[\s>])[a-z0-9_:-]*?(?:definition|graph|class|style|epub|type|span|div|para)[a-z0-9_:-]*(?:&gt;|>)\s*").unwrap();
    let mut html = broken.replace_all(raw, " ").into_owned();
    let anchor = Regex::new(r"(?is)<a\b([^>]*)>(.*?)</a>").unwrap();
    html = anchor
        .replace_all(&html, |caps: &Captures<'_>| {
            let attrs = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let body = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let valid = attrs.to_lowercase().contains("href=")
                && !attrs.to_lowercase().contains("javascript:")
                && !attrs.to_lowercase().contains("href=\"#\"");
            if valid { caps.get(0).unwrap().as_str().to_string() } else { body.to_string() }
        })
        .into_owned();
    // Números de página aislados.
    let page_number = Regex::new(r"(?is)<p[^>]*>\s*(?:pág\.?|p\.?|page)?\s*\d{1,4}\s*</p>").unwrap();
    html = page_number.replace_all(&html, "").into_owned();
    // Encabezados/pies repetidos: normaliza dígitos y elimina los que aparecen >= 4 veces.
    let para = Regex::new(r"(?is)<p([^>]*)>(.*?)</p>").unwrap();
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for cap in para.captures_iter(&html) {
        let text = Regex::new(r"<[^>]+>").unwrap().replace_all(cap.get(2).map(|m| m.as_str()).unwrap_or(""), " ");
        let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if clean.chars().count() <= 85 && !clean.is_empty() {
            let key = Regex::new(r"\d+").unwrap().replace_all(&clean.to_lowercase(), "#").to_string();
            *counts.entry(key).or_insert(0) += 1;
        }
    }
    let repeated: std::collections::HashSet<String> = counts.into_iter().filter(|(_, n)| *n >= 4).map(|(k, _)| k).collect();
    html = para.replace_all(&html, |caps: &Captures<'_>| {
        let attrs = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let inner = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        let text = Regex::new(r"<[^>]+>").unwrap().replace_all(inner, " ");
        let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
        let key = Regex::new(r"\d+").unwrap().replace_all(&clean.to_lowercase(), "#").to_string();
        if attrs.to_lowercase().contains("scripture-ref") || attrs.to_lowercase().contains("editorial-part-kicker") {
            caps.get(0).unwrap().as_str().to_string()
        } else if repeated.contains(&key) && clean.chars().count() <= 85 {
            String::new()
        } else {
            caps.get(0).unwrap().as_str().to_string()
        }
    }).into_owned();

    let bullet = Regex::new(r"(?is)<p[^>]*>\s*[•●▪◦]\s*(.*?)</p>").unwrap();
    html = bullet
        .replace_all(&html, "<ul class=\"editorial-list\"><li>$1</li></ul>")
        .into_owned();
    html.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn repair_all_books(conn: &Connection) -> Result<usize> {
    let rows = {
        let mut stmt = conn.prepare("SELECT rowid, html FROM epub_chapters")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut changed = 0;
    for (rowid, html) in rows {
        let normalized = normalize_editorial_html(&html);
        if normalized != html {
            conn.execute("UPDATE epub_chapters SET html = ?1 WHERE rowid = ?2", rusqlite::params![normalized, rowid])?;
            changed += 1;
        }
    }
    Ok(changed)
}

#[derive(Debug, Clone)]
pub struct RawChapter {
    pub title: String,
    pub html: String,
}

#[derive(Debug, Clone)]
pub struct StructuredChapter {
    pub spine: i64,
    pub title: String,
    pub href: String,
    pub html: String,
}

fn block_text(block: &str) -> String {
    Regex::new(r"<[^>]+>").unwrap().replace_all(block, " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_toc_line(line: &str) -> String {
    let no_dots = Regex::new(r"(?:\.{2,}|…+|\s+-\s+)").unwrap().replace_all(line, " ");
    let no_page = Regex::new(r"(?i)\s+(?:\d{1,4}|[ivxlcdm]{1,8})\s*$").unwrap();
    no_page.replace(&no_dots, "").trim().to_string()
}

/// Reconstruye capítulos e índice para cualquier formato de entrada.
pub fn reconstruct_book_chapters_and_toc(raw_chapters: Vec<RawChapter>) -> Vec<StructuredChapter> {
    let block_re = Regex::new(r"(?is)<(?:p|h[1-6]|div|blockquote)[^>]*>.*?</(?:p|h[1-6]|div|blockquote)>").unwrap();
    let heading_re = Regex::new(r"(?i)^(?:cap[íi]tulo|chapter|parte|part|secci[óo]n|estudio|ap[ée]ndice|introducci[óo]n|pr[óo]logo|conclusi[óo]n|bibliograf[íi]a)\b").unwrap();
    let outline_re = Regex::new(r"^(?:[IVXLCDM]+\.|[A-Z]\.|\d+\.\d*\.?|[a-z]\))\s+").unwrap();
    let toc_heading = Regex::new(r"(?i)^(?:índice|indice|contenido|tabla de contenido|table of contents|contents|sumario|índice general)\s*$").unwrap();

    let mut blocks: Vec<String> = Vec::new();
    for chapter in &raw_chapters {
        for mat in block_re.find_iter(&chapter.html) {
            blocks.push(mat.as_str().to_string());
        }
    }
    if blocks.is_empty() {
        return raw_chapters.into_iter().enumerate().map(|(index, chapter)| StructuredChapter {
            spine: index as i64,
            title: chapter.title,
            href: format!("pbb://chapter/{index}"),
            html: normalize_editorial_html(&chapter.html),
        }).collect();
    }

    let harvest_limit = (blocks.len() / 5).max(12);
    let mut toc_entries: Vec<(String, u8)> = Vec::new();
    let mut saw_toc_heading = false;
    for block in blocks.iter().take(harvest_limit) {
        let text = block_text(block);
        if toc_heading.is_match(&text) { saw_toc_heading = true; continue; }
        if !saw_toc_heading { continue; }
        if text.len() > 160 || text.is_empty() { continue; }
        let cleaned = clean_toc_line(&text);
        if cleaned.len() < 2 { continue; }
        let level = if heading_re.is_match(&cleaned) || Regex::new(r"^(?:PARTE|PART|LIBRO|BOOK)\b").unwrap().is_match(&cleaned) { 1 } else { 2 };
        toc_entries.push((cleaned, level));
    }
    // Si no hay índice impreso, reconoce los encabezados estructurales del cuerpo.
    if toc_entries.is_empty() {
        for block in &blocks {
            let text = block_text(block);
            if text.len() <= 160 && heading_re.is_match(&text) {
                toc_entries.push((clean_toc_line(&text), 1));
            }
        }
    }

    let mut chapters: Vec<StructuredChapter> = Vec::new();
    let mut current_title = raw_chapters.first().map(|c| c.title.clone()).unwrap_or_else(|| "Contenido".to_string());
    let mut current_html = String::new();
    let mut pending_number: Option<String> = None;
    let mut section_counter = 0usize;
    for block in blocks {
        let text = block_text(&block);
        let short = !text.is_empty() && text.chars().count() <= 160;
        let toc_match = short && toc_entries.iter().any(|(title, level)| *level == 1 && title.eq_ignore_ascii_case(&text));
        let structural = short && (heading_re.is_match(&text) || Regex::new(r"^(?:PARTE|PART|LIBRO|BOOK)\s+[IVXLCDM\d]").unwrap().is_match(&text));
        let number_only = short && Regex::new(r"^(?:\d{1,3}|[IVXLCDM]{1,8})$").unwrap().is_match(&text);
        if number_only { pending_number = Some(text); continue; }
        if short && (toc_match || structural) || pending_number.is_some() && short {
            if !current_html.trim().is_empty() {
                chapters.push(StructuredChapter { spine: chapters.len() as i64, title: current_title.clone(), href: format!("pbb://chapter/{}", chapters.len()), html: normalize_editorial_html(&current_html) });
            }
            let prefix = pending_number.take().map(|n| format!("{n}. ")).unwrap_or_default();
            current_title = format!("{prefix}{text}");
            current_html = format!("<h1 id=\"sec-ch-{}\">{}</h1>", chapters.len(), current_title);
            section_counter = 0;
            continue;
        }
        if short && outline_re.is_match(&text) {
            section_counter += 1;
            let level = if text.starts_with(|c: char| c.is_ascii_uppercase() && text.contains('.')) { 2 } else { 3 };
            current_html.push_str(&format!("<h{level} id=\"sec-{}-{}\" class=\"outline-lvl-{level}\">{}</h{level}>", chapters.len(), section_counter, escape_toc(&text)));
        } else {
            current_html.push_str(&block);
        }
    }
    if !current_html.trim().is_empty() {
        chapters.push(StructuredChapter { spine: chapters.len() as i64, title: current_title, href: format!("pbb://chapter/{}", chapters.len()), html: normalize_editorial_html(&current_html) });
    }
    if chapters.is_empty() {
        chapters.push(StructuredChapter { spine: 0, title: "Contenido".to_string(), href: "pbb://chapter/0".to_string(), html: normalize_editorial_html(&raw_chapters.iter().map(|c| c.html.clone()).collect::<Vec<_>>().join("\n")) });
    }
    // Índice interactivo inicial cuando hay al menos 3 capítulos.
    if chapters.len() >= 3 {
        let links = chapters.iter().map(|chapter| {
            format!("<p><a class=\"book-toc-link\" data-toc-spine=\"{}\" data-toc-anchor=\"sec-ch-{}\">{}</a></p>", chapter.spine, chapter.spine, escape_toc(&chapter.title))
        }).collect::<Vec<_>>().join("\n");
        chapters.insert(0, StructuredChapter { spine: 0, title: "Índice General".to_string(), href: "pbb://toc".to_string(), html: format!("<h1>Índice General</h1>{links}") });
        for (index, chapter) in chapters.iter_mut().enumerate() { chapter.spine = index as i64; }
    }
    chapters
}

fn escape_toc(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}
