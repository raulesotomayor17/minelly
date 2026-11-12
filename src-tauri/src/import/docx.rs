use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use regex::Regex;
use roxmltree::{Document, Node};
use zip::ZipArchive;

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DC: &str = "http://purl.org/dc/elements/1.1/";
const CP: &str = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";

#[derive(Debug, Clone)]
pub struct DocxArticle {
    pub title: String,
    pub level: u8,
    pub html: String,
    pub scripture_refs: usize,
}

#[derive(Debug, Clone)]
pub struct DocxIssue {
    pub code: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct DocxDocument {
    pub title: String,
    pub author: String,
    pub subject: String,
    pub description: String,
    pub keywords: String,
    pub articles: Vec<DocxArticle>,
    pub issues: Vec<DocxIssue>,
    pub cover: Option<(String, Vec<u8>)>,
}

#[derive(Debug, Clone, Default)]
struct StyleInfo {
    name: String,
    based_on: Option<String>,
    outline: Option<u8>,
    font_size_half_pts: Option<u32>,
    bold: bool,
}

#[derive(Debug, Clone)]
struct Paragraph {
    text: String,
    html: String,
    heading_level: Option<u8>,
    bookmarks: Vec<String>,
    page_break: bool,
    section_break: bool,
}

pub fn read_docx(path: &Path) -> Result<DocxDocument> {
    let file = File::open(path)
        .with_context(|| format!("no se pudo abrir el documento {}", path.display()))?;
    let mut archive = ZipArchive::new(file)
        .with_context(|| format!("{} no es un contenedor DOCX válido", path.display()))?;

    let document_xml = read_entry(&mut archive, "word/document.xml")?
        .ok_or_else(|| anyhow!("El DOCX no contiene word/document.xml"))?;
    let styles_xml = read_entry(&mut archive, "word/styles.xml")?.unwrap_or_default();
    let core_xml = read_entry(&mut archive, "docProps/core.xml")?.unwrap_or_default();
    let app_xml = read_entry(&mut archive, "docProps/app.xml")?.unwrap_or_default();

    let styles = parse_styles(&styles_xml)?;
    let document = Document::parse(&document_xml)
        .context("no se pudo interpretar word/document.xml")?;
    let body = document
        .descendants()
        .find(|node| node.has_tag_name((W, "body")))
        .ok_or_else(|| anyhow!("El DOCX no contiene el cuerpo del documento"))?;

    let mut toc_targets = HashSet::new();
    for hl in body
        .descendants()
        .filter(|node| node.has_tag_name((W, "hyperlink")))
    {
        if let Some(anchor) = attribute(hl, "anchor") {
            let trimmed = anchor.trim();
            if !trimmed.is_empty() {
                toc_targets.insert(trimmed.to_string());
            }
        }
    }

    let has_any_top_of = body
        .descendants()
        .filter(|node| node.has_tag_name((W, "bookmarkStart")))
        .filter_map(|bm| attribute(bm, "name"))
        .any(|name| name.starts_with("Top_of_"));

    let mut paragraphs = Vec::new();
    for child in body.children().filter(|node| node.is_element()) {
        if child.has_tag_name((W, "p")) {
            paragraphs.push(parse_paragraph(child, &styles, &toc_targets, has_any_top_of));
        } else if child.has_tag_name((W, "tbl")) {
            for paragraph in child
                .descendants()
                .filter(|node| node.has_tag_name((W, "p")))
            {
                paragraphs.push(parse_paragraph(
                    paragraph,
                    &styles,
                    &toc_targets,
                    has_any_top_of,
                ));
            }
        }
    }

    let core = parse_core(&core_xml)?;
    let company = parse_app(&app_xml)?;
    let mut issues = Vec::new();
    let start_level = paragraphs
        .iter()
        .filter_map(|paragraph| paragraph.heading_level)
        .min()
        .unwrap_or(1);

    for paragraph in &paragraphs {
        if paragraph.heading_level.is_some()
            && paragraph.text.trim().is_empty()
            && (paragraph.page_break || paragraph.section_break)
        {
            issues.push(DocxIssue {
                code: "EMPTY_HEADING_BREAK".to_string(),
                severity: "warning".to_string(),
                message: "Encabezado vacío asociado a un salto de sección o página.".to_string(),
            });
        }
        if paragraph.text.trim().eq_ignore_ascii_case("A_UNKNOWN") {
            issues.push(DocxIssue {
                code: "UNKNOWN_ARTICLE".to_string(),
                severity: "warning".to_string(),
                message: "Se encontró el marcador de artículo desconocido A_UNKNOWN.".to_string(),
            });
        }
    }

    let mut articles = Vec::new();
    let mut current: Option<DocxArticle> = None;
    let mut current_has_body = false;
    let mut current_title_merged = false;
    let mut intro = Vec::new();
    let mut saw_heading = false;
    let mut auto_sec_counter: usize = 0;

    for paragraph in &paragraphs {
        let anchor_spans = paragraph
            .bookmarks
            .iter()
            .map(|bm| format!("<span id=\"{}\" class=\"docx-bookmark\"></span>", escape_html(bm)))
            .collect::<Vec<_>>()
            .join("");

        match paragraph.heading_level {
            Some(level) if level == start_level => {
                saw_heading = true;
                let pending_kicker = close_article(&mut current, &mut articles, &mut issues);
                if paragraph.text.trim().is_empty() {
                    issues.push(DocxIssue {
                        code: "EMPTY_HEADING".to_string(),
                        severity: "warning".to_string(),
                        message: "Hay un encabezado de artículo sin texto.".to_string(),
                    });
                }
                let trimmed_title = paragraph.text.trim();
                let initial_html = if !trimmed_title.is_empty() {
                    auto_sec_counter += 1;
                    let sec_id = paragraph
                        .bookmarks
                        .first()
                        .cloned()
                        .unwrap_or_else(|| format!("sec-ch-{auto_sec_counter}"));
                    format!(
                        "{anchor_spans}<h1 id=\"{}\">{}</h1>",
                        escape_html(&sec_id),
                        paragraph.html
                    )
                } else {
                    anchor_spans
                };
                let initial_html = if let Some(kicker) = pending_kicker {
                    format!("<div class=\"editorial-part-kicker\">{}</div>{}", escape_html(&kicker), initial_html)
                } else {
                    initial_html
                };
                current = Some(DocxArticle {
                    title: if trimmed_title.is_empty() {
                        "Artículo sin título".to_string()
                    } else {
                        trimmed_title.to_string()
                    },
                    level: level as u8,
                    html: initial_html,
                    scripture_refs: 0,
                });
                current_has_body = false;
                current_title_merged = false;
            }
            Some(level) => {
                saw_heading = true;
                let tag_level = level.clamp(2, 4);
                auto_sec_counter += 1;
                let primary_id = paragraph
                    .bookmarks
                    .first()
                    .map(|bm| format!(" id=\"{}\"", escape_html(bm)))
                    .unwrap_or_else(|| format!(" id=\"sec-auto-{auto_sec_counter}\""));
                let extra_spans = paragraph
                    .bookmarks
                    .iter()
                    .skip(1)
                    .map(|bm| format!("<span id=\"{}\" class=\"docx-bookmark\"></span>", escape_html(bm)))
                    .collect::<Vec<_>>()
                    .join("");
                let heading = format!(
                    "<h{tag_level}{primary_id}>{extra_spans}{}</h{tag_level}>",
                    paragraph.html
                );
                if let Some(article) = current.as_mut() {
                    let sub_text = paragraph.text.trim();
                    if !current_has_body && !current_title_merged && !sub_text.is_empty() {
                        if article.title == "Artículo sin título" {
                            article.title = sub_text.to_string();
                            current_title_merged = true;
                        } else if is_short_chapter_prefix(&article.title) {
                            let sep = if article.title.chars().all(|c| c.is_ascii_digit()) {
                                ". "
                            } else if article.title.ends_with(':') || article.title.ends_with('.') {
                                " "
                            } else {
                                " — "
                            };
                            article.title = format!("{}{}{}", article.title, sep, sub_text);
                            current_title_merged = true;
                        }
                    }
                    article.html.push_str(&heading);
                } else {
                    intro.push(heading);
                }
            }
            None => {
                if paragraph.text.trim().is_empty() && anchor_spans.is_empty() {
                    continue;
                }
                let block = format!("<p>{anchor_spans}{}</p>", paragraph.html);
                if let Some(article) = current.as_mut() {
                    let p_text = paragraph.text.trim();
                    if !p_text.is_empty() {
                        if article.title == "Artículo sin título" && !current_has_body {
                            article.title = p_text.chars().take(90).collect();
                        }
                        current_has_body = true;
                    }
                    article.html.push_str(&block);
                } else {
                    intro.push(block);
                }
            }
        }
    }
    let _ = close_article(&mut current, &mut articles, &mut issues);

    if !saw_heading {
        if !intro.is_empty() {
            articles.push(DocxArticle {
                title: core
                    .title
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "Libro".to_string()),
                level: 1,
                html: intro.join(""),
                scripture_refs: 0,
            });
        }
    } else if !intro.is_empty() {
        articles.insert(
            0,
            DocxArticle {
                title: "Introducción".to_string(),
                level: 1,
                html: intro.join(""),
                scripture_refs: 0,
            },
        );
    }

    let id_re = Regex::new(r#"id="([^"]+)""#).expect("regex id");
    let mut bookmark_to_spine: HashMap<String, usize> = HashMap::new();
    for (spine_idx, article) in articles.iter().enumerate() {
        for cap in id_re.captures_iter(&article.html) {
            if let Some(m) = cap.get(1) {
                bookmark_to_spine.insert(m.as_str().to_string(), spine_idx);
            }
        }
    }

    let toc_anchor_re = Regex::new(r#"data-toc-anchor="([^"]+)""#).expect("regex toc anchor");
    for article in &mut articles {
        let resolved_html = toc_anchor_re
            .replace_all(&article.html, |caps: &regex::Captures<'_>| {
                let anchor = &caps[1];
                if let Some(spine_idx) = bookmark_to_spine.get(anchor) {
                    format!(r#"data-toc-anchor="{anchor}" data-toc-spine="{spine_idx}""#)
                } else {
                    caps[0].to_string()
                }
            })
            .into_owned();
        let (html, count) = tag_scriptures(&resolved_html);
        article.html = html;
        article.scripture_refs = count;
    }

    if articles.is_empty() {
        return Err(anyhow!("El DOCX no contiene artículos con texto."));
    }

    let cover = read_cover(&mut archive)?;
    Ok(DocxDocument {
        title: core
            .title
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_default(),
        author: core
            .creator
            .filter(|value| !value.trim().is_empty())
            .or(company)
            .unwrap_or_default(),
        subject: core.subject.unwrap_or_default(),
        description: core.description.unwrap_or_default(),
        keywords: core.keywords.unwrap_or_default(),
        articles,
        issues,
        cover,
    })
}

fn close_article(
    current: &mut Option<DocxArticle>,
    articles: &mut Vec<DocxArticle>,
    _issues: &mut Vec<DocxIssue>,
) -> Option<String> {
    let Some(article) = current.take() else { return None; };
    let body = article.html.split("</h1>").nth(1).unwrap_or("").trim();
    if body.is_empty() {
        // Dos encabezados consecutivos: el primero se convierte en antetítulo
        // del siguiente y no produce un artículo vacío.
        return Some(article.title);
    }
    articles.push(article);
    None
}

fn read_entry(archive: &mut ZipArchive<File>, name: &str) -> Result<Option<String>> {
    let mut entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let mut value = String::new();
    entry.read_to_string(&mut value)?;
    Ok(Some(value))
}

fn is_short_chapter_prefix(title: &str) -> bool {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return true;
    }
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    if trimmed.ends_with(':') && trimmed.chars().count() <= 35 {
        return true;
    }
    let upper = trimmed.to_uppercase();
    if (upper.starts_with("CAPÍTULO")
        || upper.starts_with("CAPITULO")
        || upper.starts_with("CHAPTER")
        || upper.starts_with("PARTE ")
        || upper.contains(" PARTE")
        || upper.starts_with("SECCIÓN")
        || upper.starts_with("SECCION")
        || upper.starts_with("APÉNDICE")
        || upper.starts_with("APENDICE"))
        && trimmed.chars().count() <= 30
    {
        return true;
    }
    false
}

fn parse_styles(xml: &str) -> Result<HashMap<String, StyleInfo>> {
    if xml.trim().is_empty() {
        return Ok(HashMap::new());
    }
    let document = Document::parse(xml).context("no se pudo interpretar styles.xml")?;
    let mut styles: HashMap<String, StyleInfo> = HashMap::new();
    for style in document
        .descendants()
        .filter(|node| node.has_tag_name((W, "style")))
    {
        let Some(id) = attribute(style, "styleId") else {
            continue;
        };
        let name = style
            .children()
            .find(|node| node.has_tag_name((W, "name")))
            .and_then(|node| attribute(node, "val"))
            .unwrap_or_else(|| id.clone());
        let based_on = style
            .children()
            .find(|node| node.has_tag_name((W, "basedOn")))
            .and_then(|node| attribute(node, "val"));
        let outline = style
            .children()
            .find(|node| node.has_tag_name((W, "pPr")))
            .and_then(|ppr| {
                ppr.children()
                    .find(|n| n.has_tag_name((W, "outlineLvl")))
                    .and_then(|lvl| attribute(lvl, "val"))
                    .and_then(|v| v.parse::<u8>().ok())
            });
        let rpr = style
            .children()
            .find(|node| node.has_tag_name((W, "rPr")));
        let font_size_half_pts = rpr.and_then(|r| {
            r.children()
                .find(|n| n.has_tag_name((W, "sz")))
                .and_then(|sz| attribute(sz, "val"))
                .and_then(|v| v.parse::<u32>().ok())
        });
        let bold = rpr
            .and_then(|r| r.children().find(|n| n.has_tag_name((W, "b"))))
            .map(|b_node| {
                attribute(b_node, "val")
                    .map(|v| !matches!(v.as_str(), "0" | "false" | "off"))
                    .unwrap_or(true)
            })
            .unwrap_or(false);

        styles.insert(
            id,
            StyleInfo {
                name,
                based_on,
                outline,
                font_size_half_pts,
                bold,
            },
        );
    }

    let keys: Vec<String> = styles.keys().cloned().collect();
    for key in keys {
        let mut current_base = styles.get(&key).and_then(|s| s.based_on.clone());
        let mut depth = 0;
        while let Some(base_id) = current_base {
            if depth > 6 {
                break;
            }
            depth += 1;
            let Some(base_info) = styles.get(&base_id).cloned() else {
                break;
            };
            if let Some(entry) = styles.get_mut(&key) {
                if entry.outline.is_none() {
                    entry.outline = base_info.outline;
                }
                if entry.font_size_half_pts.is_none() {
                    entry.font_size_half_pts = base_info.font_size_half_pts;
                }
                if !entry.bold && base_info.bold {
                    entry.bold = true;
                }
            }
            current_base = base_info.based_on;
        }
    }

    Ok(styles)
}

fn render_run(run: Node<'_, '_>, text_acc: &mut String, inside_hyperlink: bool) -> String {
    let mut run_text = String::new();
    for child in run.children().filter(|child| child.is_element()) {
        if child.has_tag_name((W, "t")) {
            run_text.push_str(child.text().unwrap_or_default());
        } else if child.has_tag_name((W, "tab")) {
            run_text.push('\t');
        } else if child.has_tag_name((W, "br")) {
            run_text.push('\n');
        }
    }
    if run_text.is_empty() {
        return String::new();
    }
    text_acc.push_str(&run_text);
    let props = run
        .children()
        .find(|child| child.has_tag_name((W, "rPr")));
    let bold = props
        .and_then(|value| value.children().find(|child| child.has_tag_name((W, "b"))))
        .map(|b_node| {
            attribute(b_node, "val")
                .map(|v| !matches!(v.as_str(), "0" | "false" | "off"))
                .unwrap_or(true)
        })
        .unwrap_or(false);
    let italic = props
        .map(|value| value.children().any(|child| child.has_tag_name((W, "i"))))
        .unwrap_or(false);
    let underline = !inside_hyperlink
        && props
            .map(|value| value.children().any(|child| child.has_tag_name((W, "u"))))
            .unwrap_or(false);
    let mut escaped = escape_html(&run_text);
    if bold {
        escaped = format!("<strong>{escaped}</strong>");
    }
    if italic {
        escaped = format!("<em>{escaped}</em>");
    }
    if underline {
        escaped = format!("<u>{escaped}</u>");
    }
    escaped
}

fn parse_paragraph(
    node: Node<'_, '_>,
    styles: &HashMap<String, StyleInfo>,
    toc_targets: &HashSet<String>,
    has_any_top_of: bool,
) -> Paragraph {
    let style_id = node
        .children()
        .find(|child| child.has_tag_name((W, "pPr")))
        .and_then(|properties| {
            properties
                .children()
                .find(|child| child.has_tag_name((W, "pStyle")))
                .and_then(|style| attribute(style, "val"))
        });
    let style_info = style_id.as_ref().and_then(|id| styles.get(id));
    let style_name = style_info
        .map(|info| info.name.clone())
        .unwrap_or_default();
    let outline = node
        .children()
        .find(|child| child.has_tag_name((W, "pPr")))
        .and_then(|properties| {
            properties
                .children()
                .find(|child| child.has_tag_name((W, "outlineLvl")))
                .and_then(|level| attribute(level, "val"))
                .and_then(|value| value.parse::<u8>().ok())
        })
        .or_else(|| style_info.and_then(|info| info.outline));

    let mut bookmarks = Vec::new();
    for bm in node
        .descendants()
        .filter(|child| child.has_tag_name((W, "bookmarkStart")))
    {
        if let Some(name) = attribute(bm, "name") {
            let trimmed = name.trim();
            if !trimmed.is_empty() && !trimmed.starts_with("_GoBack") {
                bookmarks.push(trimmed.to_string());
            }
        }
    }

    let mut text = String::new();
    let mut html = String::new();
    let mut has_hyperlink = false;
    let mut max_run_sz: Option<u32> = None;
    let mut all_runs_bold = true;
    let mut saw_text_run = false;

    for child in node.children().filter(|c| c.is_element()) {
        if child.has_tag_name((W, "r")) {
            let mut run_text = String::new();
            let rendered = render_run(child, &mut run_text, false);
            if !run_text.trim().is_empty() {
                saw_text_run = true;
                let rpr = child.children().find(|n| n.has_tag_name((W, "rPr")));
                let r_sz = rpr.and_then(|r| {
                    r.children()
                        .find(|n| n.has_tag_name((W, "sz")))
                        .and_then(|sz| attribute(sz, "val"))
                        .and_then(|v| v.parse::<u32>().ok())
                });
                if let Some(sz) = r_sz {
                    max_run_sz = Some(max_run_sz.map_or(sz, |prev| prev.max(sz)));
                }
                let r_bold = rpr
                    .and_then(|r| r.children().find(|n| n.has_tag_name((W, "b"))))
                    .map(|b_node| {
                        attribute(b_node, "val")
                            .map(|v| !matches!(v.as_str(), "0" | "false" | "off"))
                            .unwrap_or(true)
                    })
                    .unwrap_or(false);
                if !r_bold && !style_info.map(|s| s.bold).unwrap_or(false) {
                    all_runs_bold = false;
                }
            }
            text.push_str(&run_text);
            html.push_str(&rendered);
        } else if child.has_tag_name((W, "hyperlink")) {
            has_hyperlink = true;
            let anchor = attribute(child, "anchor").unwrap_or_default();
            let mut link_html = String::new();
            for run in child.descendants().filter(|n| n.has_tag_name((W, "r"))) {
                link_html.push_str(&render_run(run, &mut text, true));
            }
            if !anchor.is_empty() && !link_html.is_empty() {
                let esc_anchor = escape_html(&anchor);
                html.push_str(&format!(
                    "<a href=\"#{esc_anchor}\" class=\"book-toc-link\" data-toc-anchor=\"{esc_anchor}\">{link_html}</a>"
                ));
            } else {
                html.push_str(&link_html);
            }
        }
    }

    let effective_sz = max_run_sz.or_else(|| style_info.and_then(|s| s.font_size_half_pts));
    let effective_bold = (saw_text_run && all_runs_bold) || style_info.map(|s| s.bold).unwrap_or(false);

    let mut heading_level = heading_level(&style_id, &style_name, outline);
    if heading_level.is_none() && !has_hyperlink {
        heading_level = infer_semantic_heading_level(
            &text,
            &bookmarks,
            toc_targets,
            has_any_top_of,
            effective_sz,
            effective_bold,
        );
    }

    let normalized_style = style_name.trim().to_ascii_lowercase();
    let has_top_bookmark = bookmarks.iter().any(|b| b.starts_with("Top_of_"));
    let is_document_title = heading_level.is_none()
        && !has_top_bookmark
        && matches!(
            normalized_style.as_str(),
            "title" | "título" | "titulo" | "document title" | "título del documento"
        );

    let page_break = node.descendants().any(|child| {
        child.has_tag_name((W, "br"))
            && attribute(child, "type")
                .map(|value| value.eq_ignore_ascii_case("page"))
                .unwrap_or(false)
    }) || node
        .descendants()
        .any(|child| child.has_tag_name((W, "lastRenderedPageBreak")));
    let section_break = node
        .descendants()
        .any(|child| child.has_tag_name((W, "sectPr")));

    if is_document_title {
        text.clear();
        html.clear();
    }

    Paragraph {
        text,
        html,
        heading_level,
        bookmarks,
        page_break,
        section_break,
    }
}

fn infer_semantic_heading_level(
    raw_text: &str,
    bookmarks: &[String],
    toc_targets: &HashSet<String>,
    has_any_top_of: bool,
    effective_sz: Option<u32>,
    effective_bold: bool,
) -> Option<u8> {
    let normalized_ws = raw_text.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = normalized_ws.trim();

    let has_top_bookmark = bookmarks.iter().any(|b| b.starts_with("Top_of_"));
    if has_top_bookmark {
        return Some(1);
    }
    if trimmed.is_empty() || trimmed.chars().count() > 160 {
        return None;
    }
    if matches!(
        trimmed,
        "Table of Contents" | "Tabla de contenido" | "Índice" | "ÍNDICE" | "Contenido" | "CONTENIDO"
    ) {
        return Some(1);
    }

    // Implicit typographic hierarchy from Word/Calibre styles (font size in half-points + bold)
    if let Some(sz) = effective_sz {
        if sz >= 32 {
            // >= 16pt font: Chapter/Part title (level 1 if no Top_of_ bookmarks exist, or level 2 which merges into the preceding Top_of_ chapter header)
            return Some(if has_any_top_of { 2 } else { 1 });
        }
        if sz >= 26 && effective_bold {
            // >= 13pt bold font: Major section heading inside chapter
            return Some(2);
        }
        if sz >= 26 {
            // >= 13pt regular/italic font: Chapter subtitle or sub-section
            return Some(3);
        }
    }

    let is_bookmarked_heading = bookmarks.iter().any(|b| {
        toc_targets.contains(b) || b.starts_with("_idTextAnchor")
    });

    let upper = trimmed.to_uppercase();
    if !has_any_top_of
        && (upper.starts_with("CAPÍTULO ")
            || upper.starts_with("CAPITULO ")
            || upper.starts_with("CHAPTER ")
            || upper.starts_with("EXCURSUS ")
            || upper.starts_with("PRIMERA PARTE")
            || upper.starts_with("SEGUNDA PARTE")
            || upper.starts_with("TERCERA PARTE")
            || upper.starts_with("CUARTA PARTE"))
    {
        return Some(1);
    }
    if is_bookmarked_heading && upper == "BOSQUEJO" {
        return Some(1);
    }

    if !is_bookmarked_heading {
        let roman_re = Regex::new(r"^[IVXLCDM]{1,6}\.\s+\S").unwrap();
        let alpha_re = Regex::new(r"^[A-ZÑ]\.\s+\S").unwrap();
        if roman_re.is_match(trimmed) && !trimmed.ends_with('.') {
            return Some(2);
        }
        if alpha_re.is_match(trimmed) && !trimmed.ends_with('.') {
            return Some(3);
        }
        if effective_bold && trimmed.chars().count() <= 85 && !trimmed.ends_with('.') {
            if matches!(
                upper.as_str(),
                "INTRODUCCIÓN"
                    | "INTRODUCCION"
                    | "PREFACIO"
                    | "PRESENTACIÓN"
                    | "PRESENTACION"
                    | "ABREVIATURAS"
                    | "CONCLUSIÓN"
                    | "CONCLUSION"
                    | "CONCLUSIONES"
                    | "BIBLIOGRAFÍA"
                    | "BIBLIOGRAFIA"
            ) {
                return Some(if has_any_top_of { 2 } else { 1 });
            }
        }
        return None;
    }

    let roman_re = Regex::new(r"^[IVXLCDM]{1,6}\.\s+\S").unwrap();
    let alpha_re = Regex::new(r"^[A-ZÑ]\.\s+\S").unwrap();
    let decimal_re = Regex::new(r"^\d+\.\d+").unwrap();
    let number_re = Regex::new(r"^\d+\.\s+\S").unwrap();

    if roman_re.is_match(trimmed)
        || matches!(
            upper.as_str(),
            "INTRODUCCIÓN"
                | "INTRODUCCION"
                | "CONCLUSIÓN"
                | "CONCLUSION"
                | "CONCLUSIONES"
                | "BIBLIOGRAFÍA"
                | "BIBLIOGRAFIA"
        )
    {
        Some(2)
    } else if alpha_re.is_match(trimmed) {
        Some(3)
    } else if decimal_re.is_match(trimmed) || number_re.is_match(trimmed) {
        Some(4)
    } else {
        Some(3)
    }
}

fn heading_level(
    style_id: &Option<String>,
    style_name: &str,
    outline: Option<u8>,
) -> Option<u8> {
    if let Some(level) = outline {
        if level < 9 {
            return Some(level + 1);
        }
    }
    let normalized = format!(
        "{} {}",
        style_id.clone().unwrap_or_default(),
        style_name
    )
    .to_ascii_lowercase();
    let heading_re =
        Regex::new(r"(?:heading|t[ií]tulo|titulo)\s*([1-6])").expect("regex de encabezados");
    if let Some(captures) = heading_re.captures(&normalized) {
        return captures
            .get(1)
            .and_then(|value| value.as_str().parse::<u8>().ok());
    }
    None
}

fn tag_scriptures(html: &str) -> (String, usize) {
    let regex = Regex::new(
        r"(?i)\b(?:[1-3]\s*)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s+\d{1,3}:\d{1,3}(?:\s*[-–]\s*\d{1,3})?\b",
    )
    .expect("regex de referencias bíblicas");
    let mut result = String::with_capacity(html.len());
    let mut text = String::new();
    let mut in_tag = false;
    let mut count = 0;

    let flush = |text: &mut String, result: &mut String, count: &mut usize| {
        if text.is_empty() {
            return;
        }
        let mut last = 0;
        for found in regex.find_iter(text) {
            result.push_str(&text[last..found.start()]);
            result.push_str("<span class=\"scripture-ref\" data-ref=\"");
            result.push_str(&escape_html(found.as_str()));
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

fn parse_core(xml: &str) -> Result<CoreMetadata> {
    if xml.trim().is_empty() {
        return Ok(CoreMetadata::default());
    }
    let document = Document::parse(xml).context("no se pudo interpretar core.xml")?;
    let value = |namespace: &str, name: &str| {
        document
            .descendants()
            .find(|node| node.has_tag_name((namespace, name)))
            .and_then(|node| node.text())
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    Ok(CoreMetadata {
        title: value(DC, "title"),
        creator: value(DC, "creator"),
        subject: value(DC, "subject"),
        description: value(DC, "description"),
        keywords: value(CP, "keywords"),
    })
}

fn parse_app(xml: &str) -> Result<Option<String>> {
    if xml.trim().is_empty() {
        return Ok(None);
    }
    let document = Document::parse(xml).context("no se pudo interpretar app.xml")?;
    Ok(document
        .descendants()
        .find(|node| node.tag_name().name() == "Company")
        .and_then(|node| node.text())
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string))
}

fn read_cover(archive: &mut ZipArchive<File>) -> Result<Option<(String, Vec<u8>)>> {
    let names = archive
        .file_names()
        .filter_map(|name| name.ok())
        .map(|name| name.to_string())
        .collect::<Vec<_>>();
    for name in names {
        let lower = name.to_ascii_lowercase();
        if lower.starts_with("word/media/")
            && (lower.ends_with(".png")
                || lower.ends_with(".jpg")
                || lower.ends_with(".jpeg"))
        {
            let mut entry = archive.by_name(&name)?;
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;
            if bytes.len() > 1024 {
                let extension = if lower.ends_with(".png") { "png" } else { "jpg" };
                return Ok(Some((extension.to_string(), bytes)));
            }
        }
    }
    Ok(None)
}

fn attribute(node: Node<'_, '_>, name: &str) -> Option<String> {
    node.attributes()
        .find(|attribute| attribute.name() == name)
        .map(|attribute| attribute.value().to_string())
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[derive(Default)]
struct CoreMetadata {
    title: Option<String>,
    creator: Option<String>,
    subject: Option<String>,
    description: Option<String>,
    keywords: Option<String>,
}
