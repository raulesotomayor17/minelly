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
