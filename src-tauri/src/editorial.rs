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
