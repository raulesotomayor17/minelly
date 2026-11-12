use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use rusqlite::params;
use zip::ZipArchive;

use crate::db::{now_epoch, Catalog};
use crate::model::{
    DictionaryEntry, InterlinearImportReport, InterlinearStatus, InterlinearToken,
    InterlinearVerse, Resource, ResourceKind,
};

const RESOURCE_ID: &str = "stepbible:tagnt";
const LEXICON_RESOURCE_ID: &str = "stepbible:lexicon";

pub fn import_stepbible(
    catalog: &mut Catalog,
    path: impl AsRef<Path>,
) -> Result<InterlinearImportReport> {
    let path = path.as_ref();
    let mut parsed = Vec::new();
    let mut lexicon_entries: BTreeMap<String, String> = BTreeMap::new();
    let mut source = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string());

    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
    {
        let file = File::open(path)
            .with_context(|| format!("no se pudo abrir {}", path.display()))?;
        let mut archive = ZipArchive::new(file).context("el archivo no es un ZIP válido")?;

        let mut has_modern = false;
        for index in 0..archive.len() {
            let entry = archive.by_index(index)?;
            let Some(name) = entry.enclosed_name().map(|p| p.to_string_lossy().to_string()) else {
                continue;
            };
            if name.contains("Translators Amalgamated OT+NT/TA")
                && !name.contains("OLD format")
                && name.to_ascii_lowercase().ends_with(".txt")
            {
                has_modern = true;
                break;
            }
        }

        let mut files = 0;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index)?;
            let name = match entry.name() {
                Ok(value) => value.to_string(),
                Err(_) => continue,
            };
            if !name.to_ascii_lowercase().ends_with(".txt") {
                continue;
            }
            let is_older = name.contains("Older Formats/") || name.contains("OLD format");
            if is_older && has_modern {
                continue;
            }

            if name.contains("Lexicons/TBESG") || name.contains("Lexicons/TBESH") {
                let mut text = String::new();
                if entry.read_to_string(&mut text).is_ok() {
                    parse_lexicon(&text, &mut lexicon_entries);
                }
                continue;
            }

            if name.contains("TAHOT") {
                let mut text = String::new();
                entry.read_to_string(&mut text)?;
                parsed.extend(parse_tahot(&text, &mut source));
                files += 1;
            } else if name.contains("TAGNT") {
                let mut text = String::new();
                entry.read_to_string(&mut text)?;
                parsed.extend(parse_tagnt(&text, &mut source));
                files += 1;
            }
        }
        if files == 0 {
            return Err(anyhow!(
                "El ZIP no contiene archivos TAGNT/TAHOT de STEPBible. Descarga STEPBible-Data y selecciona el ZIP completo."
            ));
        }
    } else {
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("no se pudo leer {}", path.display()))?;
        let file_tokens = parse_tagnt(&text, &mut source);
        if file_tokens.is_empty() {
            parsed.extend(parse_tahot(&text, &mut source));
        } else {
            parsed.extend(file_tokens);
        }
    }

    if parsed.is_empty() {
        return Err(anyhow!(
            "No se encontraron tokens interlineales válidos (TAGNT/TAHOT) en el archivo."
        ));
    }

    let verses = parsed
        .iter()
        .map(|token| (token.0, token.1, token.2))
        .collect::<BTreeSet<_>>()
        .len();
    let books = parsed
        .iter()
        .map(|token| token.0)
        .collect::<BTreeSet<_>>()
        .len();

    {
        let connection = catalog.connection_mut();
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM interlinear_tokens WHERE resource_id = ?1",
            [RESOURCE_ID],
        )?;
        {
            let mut insert = transaction.prepare(
                "INSERT INTO interlinear_tokens
                 (resource_id, book, chapter, verse, word_order, surface_text, original_manuscript,
                  transliteration, lemma, strong_number, morphology_code)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )?;
            for (book, chapter, verse, token) in &parsed {
                insert.execute(params![
                    RESOURCE_ID,
                    book,
                    chapter,
                    verse,
                    token.word_order,
                    token.surface_text,
                    token.original_manuscript,
                    token.transliteration,
                    token.lemma,
                    token.strong_number,
                    token.morphology_code,
                ])?;
            }
        }
        transaction.commit()?;
    }

    if !lexicon_entries.is_empty() {
        let dict_entries: Vec<DictionaryEntry> = lexicon_entries
            .into_iter()
            .map(|(topic, html)| DictionaryEntry { topic, html })
            .collect();
        let resource = Resource {
            id: LEXICON_RESOURCE_ID.to_string(),
            kind: ResourceKind::Dictionary,
            title: "STEPBible — Lexicón Strong Extendido (Griego y Hebreo)".to_string(),
            abbreviation: "STEP-Lex".to_string(),
            language: "mul".to_string(),
            source_format: "stepbible".to_string(),
            source_path: path.display().to_string(),
            verse_count: 0,
            entry_count: dict_entries.len() as i64,
            imported_at: now_epoch(),
            search_priority: 0,
            cloud_synced: false,
            metadata: serde_json::json!({
                "license": "CC BY 4.0",
                "attribution": "STEPBible.org / Tyndale House Cambridge"
            }),
        };
        catalog.upsert_resource(&resource)?;
        catalog.replace_dictionary(LEXICON_RESOURCE_ID, &dict_entries)?;
    }

    Ok(InterlinearImportReport {
        tokens: parsed.len(),
        books,
        verses,
        source,
    })
}

pub fn status(catalog: &Catalog) -> Result<InterlinearStatus> {
    let (tokens, books, verses) = catalog.connection().query_row(
        "SELECT COUNT(*), COUNT(DISTINCT book), COUNT(DISTINCT book || ':' || chapter || ':' || verse)
         FROM interlinear_tokens WHERE resource_id = ?1",
        [RESOURCE_ID],
        |row| {
            Ok((
                row.get::<_, i64>(0)? as usize,
                row.get::<_, i64>(1)? as usize,
                row.get::<_, i64>(2)? as usize,
            ))
        },
    )?;
    Ok(InterlinearStatus {
        tokens,
        books,
        verses,
    })
}

pub fn chapter(catalog: &Catalog, book: i64, chapter: i64) -> Result<Vec<InterlinearVerse>> {
    let mut statement = catalog.connection().prepare(
        "SELECT verse, word_order, surface_text, original_manuscript, transliteration, lemma,
                strong_number, morphology_code
         FROM interlinear_tokens
         WHERE resource_id = ?1 AND book = ?2 AND chapter = ?3
         ORDER BY verse, word_order",
    )?;
    let rows = statement.query_map(params![RESOURCE_ID, book, chapter], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            InterlinearToken {
                word_order: row.get(1)?,
                surface_text: row.get(2)?,
                original_manuscript: row.get(3)?,
                transliteration: row.get(4)?,
                lemma: row.get(5)?,
                strong_number: row.get(6)?,
                morphology_code: row.get(7)?,
                spanish_gloss: String::new(),
            },
        ))
    })?;
    let mut grouped: Vec<InterlinearVerse> = Vec::new();
    for row in rows {
        let (verse, token) = row?;
        if grouped.last().map(|current| current.verse) != Some(verse) {
            grouped.push(InterlinearVerse {
                verse,
                tokens: Vec::new(),
            });
        }
        if let Some(current) = grouped.last_mut() {
            current.tokens.push(token);
        }
    }
    for verse in &mut grouped {
        for token in &mut verse.tokens {
            if let Some(gloss) = spanish_gloss(catalog.connection(), &token.strong_number) {
                token.spanish_gloss = gloss;
            }
        }
    }
    Ok(grouped)
}

fn spanish_gloss(connection: &rusqlite::Connection, strong: &str) -> Option<String> {
    if strong.is_empty() {
        return None;
    }
    let mut candidates = vec![strong.to_string()];
    let prefix = strong.chars().next()?;
    let digits = strong[1..]
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>();
    if !digits.is_empty() {
        if let Ok(number) = digits.parse::<u32>() {
            let normalized = format!("{prefix}{number}");
            if normalized != strong {
                candidates.push(normalized);
            }
        }
    }
    for candidate in candidates {
        let html: Option<String> = connection
            .query_row(
                "SELECT html FROM dictionary
                 WHERE topic = ?1 AND html LIKE '%Definición Strong:%'
                 LIMIT 1",
                [candidate],
                |row| row.get(0),
            )
            .ok();
        if let Some(gloss) = html.as_deref().and_then(extract_spanish_gloss) {
            return Some(gloss);
        }
    }
    None
}

fn extract_spanish_gloss(html: &str) -> Option<String> {
    let marker = "Definición Strong:";
    let start = html.find(marker)? + marker.len();
    let rest = &html[start..];
    let end = rest
        .find("<br><b>")
        .or_else(|| rest.find("<hr><b>"))
        .or_else(|| rest.find("<hr/>"))
        .unwrap_or(rest.len());
    let text = crate::indexer::strip_html(&rest[..end]);
    let mut gloss = text
        .rsplit('—')
        .next()
        .unwrap_or(&text)
        .trim()
        .trim_start_matches(['–', '-'])
        .trim()
        .to_string();
    for marker in [
        "Equivalencia BDB",
        "Equivalencia TWOT",
        "Categoría gramatical",
        "Apariciones en BHS",
        "Apariciones en Textos",
        "Num. Goodrick",
        "Etimología",
        "Cognados",
    ] {
        if let Some(position) = gloss.find(marker) {
            gloss.truncate(position);
            break;
        }
    }
    let gloss = gloss.trim().trim_end_matches([',', ';', '.']).trim();
    if gloss.is_empty() {
        return None;
    }
    let mut short = gloss.chars().take(32).collect::<String>();
    if let Some(cut) = short.rfind([',', ';', '.']) {
        if cut >= 8 {
            short.truncate(cut);
        }
    }
    let short = short.trim().trim_end_matches([',', ';', '.']).trim();
    if short.is_empty() {
        return None;
    }
    Some(short.to_string())
}

fn parse_tagnt(text: &str, source: &mut String) -> Vec<(i64, i64, i64, InterlinearToken)> {
    let mut result = Vec::new();
    let mut last_reference: Option<(i64, i64, i64)> = None;
    let mut word_order = 0i64;
    for line in text.lines() {
        let trimmed_line = line.trim_start_matches('\u{feff}');
        if trimmed_line.is_empty() || trimmed_line.starts_with('#') {
            continue;
        }
        let columns = trimmed_line.split('\t').collect::<Vec<_>>();
        if columns.len() < 9 {
            continue;
        }
        let col0 = columns[0].trim();

        // Modern Translators Amalgamated TAGNT format: Mat.1.1#01=NKO
        if col0.contains('#') && col0.contains('=') {
            let Some((book, chapter, verse)) = parse_reference(col0) else {
                continue;
            };
            if last_reference != Some((book, chapter, verse)) {
                last_reference = Some((book, chapter, verse));
                word_order = 0;
            }
            word_order += 1;
            let (original, translit_col) = split_greek_and_translit(columns.get(1).copied().unwrap_or(""));
            if original.is_empty() {
                continue;
            }
            let transliteration = if translit_col.is_empty() {
                transliterate(&original)
            } else {
                translit_col
            };
            let original_str = original.as_str();
            let surface = first_non_empty(&[columns.get(8), columns.get(2), Some(&original_str)]);
            let (strong_from_col3, morph_from_col3) =
                split_once_trimmed(columns.get(3).copied().unwrap_or(""), '=');
            let strong_col11 = columns
                .get(11)
                .copied()
                .unwrap_or("")
                .split('_')
                .next()
                .unwrap_or("")
                .trim();
            let strong_number = if !strong_from_col3.is_empty() {
                strong_from_col3.to_string()
            } else {
                strong_col11.to_string()
            };
            let (lemma, _) = split_once_trimmed(columns.get(4).copied().unwrap_or(""), '=');
            result.push((
                book,
                chapter,
                verse,
                InterlinearToken {
                    word_order,
                    surface_text: surface.to_string(),
                    original_manuscript: original,
                    transliteration,
                    lemma: lemma.to_string(),
                    strong_number,
                    morphology_code: morph_from_col3.to_string(),
                    spanish_gloss: String::new(),
                },
            ));
            if source.is_empty() {
                *source = "STEPBible TAGNT+TAHOT".to_string();
            }
            continue;
        }

        // Legacy TAGNT format: 41_Mat.001.001
        if columns.len() >= 12 && col0.contains('_') {
            let Some((book, chapter, verse)) = parse_reference(col0) else {
                continue;
            };
            if last_reference != Some((book, chapter, verse)) {
                last_reference = Some((book, chapter, verse));
                word_order = 0;
            }
            word_order += 1;
            let surface = first_non_empty(&[columns.get(11), columns.get(3), columns.get(2)]);
            let original = columns.get(2).copied().unwrap_or("").trim().to_string();
            if original.is_empty() {
                continue;
            }
            let transliteration = transliterate(&original);
            result.push((
                book,
                chapter,
                verse,
                InterlinearToken {
                    word_order,
                    surface_text: surface.to_string(),
                    original_manuscript: original,
                    transliteration,
                    lemma: columns.get(6).copied().unwrap_or("").trim().to_string(),
                    strong_number: columns.get(4).copied().unwrap_or("").trim().to_string(),
                    morphology_code: columns.get(5).copied().unwrap_or("").trim().to_string(),
                    spanish_gloss: String::new(),
                },
            ));
            if source.is_empty() {
                *source = "STEPBible TAGNT".to_string();
            }
        }
    }
    result
}

fn parse_tahot(text: &str, source: &mut String) -> Vec<(i64, i64, i64, InterlinearToken)> {
    let mut result = Vec::new();
    let mut last_reference: Option<(i64, i64, i64)> = None;
    let mut word_order = 0i64;
    for line in text.lines() {
        let trimmed_line = line.trim_start_matches('\u{feff}');
        if trimmed_line.is_empty() || trimmed_line.starts_with('#') {
            continue;
        }
        let columns = trimmed_line.split('\t').collect::<Vec<_>>();
        if columns.len() < 6 {
            continue;
        }
        let col0 = columns[0].trim();
        if !col0.contains('#') || !col0.contains('=') {
            continue;
        }
        let Some((book, chapter, raw_verse)) = parse_reference(col0) else {
            continue;
        };
        let verse = if raw_verse == 0 { 1 } else { raw_verse };
        if last_reference != Some((book, chapter, verse)) {
            last_reference = Some((book, chapter, verse));
            word_order = 0;
        }
        word_order += 1;

        let raw_hebrew = columns.get(1).copied().unwrap_or("").trim();
        let original = raw_hebrew.replace(['/', '\\'], "");
        if original.is_empty() {
            continue;
        }
        let transliteration = columns.get(2).copied().unwrap_or("").trim().to_string();
        let original_str = original.as_str();
        let surface = first_non_empty(&[columns.get(3), Some(&original_str)]);
        let morphology_code = columns.get(5).copied().unwrap_or("").trim().to_string();

        let root_strong = columns
            .get(8)
            .copied()
            .unwrap_or("")
            .split('_')
            .next()
            .unwrap_or("")
            .trim();
        let strong_number = if !root_strong.is_empty() {
            root_strong.to_string()
        } else {
            extract_hebrew_strong(columns.get(4).copied().unwrap_or(""))
        };
        let lemma = extract_hebrew_lemma(columns.get(11).copied().unwrap_or(""));

        result.push((
            book,
            chapter,
            verse,
            InterlinearToken {
                word_order,
                surface_text: surface.to_string(),
                original_manuscript: original,
                transliteration,
                lemma,
                strong_number,
                morphology_code,
                spanish_gloss: String::new(),
            },
        ));
        if source.is_empty() {
            *source = "STEPBible TAHOT+TAGNT".to_string();
        }
    }
    result
}

fn parse_lexicon(text: &str, entries: &mut BTreeMap<String, String>) {
    for line in text.lines() {
        let trimmed = line.trim_start_matches('\u{feff}');
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('$') {
            continue;
        }
        let cols = trimmed.split('\t').collect::<Vec<_>>();
        if cols.len() < 7 {
            continue;
        }
        let e_strong = cols[0].trim();
        if !(e_strong.starts_with('G') || e_strong.starts_with('H')) {
            continue;
        }
        if !e_strong.chars().nth(1).map(|c| c.is_ascii_digit()).unwrap_or(false) {
            continue;
        }
        let u_strong = cols.get(2).copied().unwrap_or("").trim().trim_end_matches(',').trim();
        let word = cols.get(3).copied().unwrap_or("").trim();
        let translit = cols.get(4).copied().unwrap_or("").trim();
        let morph = cols.get(5).copied().unwrap_or("").trim();
        let gloss = cols.get(6).copied().unwrap_or("").trim();
        let meaning = cols.get(7).copied().unwrap_or("").trim();

        let html = format!(
            "<p><strong>{}</strong> · <span class=\"Grk\">{}</span> (<em>{}</em>) · <code>{}</code> — <strong>{}</strong></p><div>{}</div>",
            if !u_strong.is_empty() { u_strong } else { e_strong },
            word,
            translit,
            morph,
            gloss,
            meaning
        );

        if !u_strong.is_empty() {
            entries.entry(u_strong.to_string()).or_insert_with(|| html.clone());
        }
        entries.entry(e_strong.to_string()).or_insert(html);
    }
}

fn split_greek_and_translit(raw: &str) -> (String, String) {
    let trimmed = raw.trim();
    if let Some((greek, rest)) = trimmed.split_once('(') {
        let translit = rest.trim_end_matches(')').trim();
        (greek.trim().to_string(), translit.to_string())
    } else {
        (trimmed.to_string(), String::new())
    }
}

fn split_once_trimmed<'a>(raw: &'a str, delimiter: char) -> (&'a str, &'a str) {
    if let Some((left, right)) = raw.split_once(delimiter) {
        (left.trim(), right.trim())
    } else {
        (raw.trim(), "")
    }
}

fn extract_hebrew_strong(dstrongs: &str) -> String {
    if let Some(start) = dstrongs.find('{') {
        let after = &dstrongs[start + 1..];
        if let Some(end) = after.find('}') {
            return after[..end].trim().to_string();
        }
    }
    dstrongs
        .split(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim_matches(['{', '}'])
        .trim()
        .to_string()
}

fn extract_hebrew_lemma(expanded: &str) -> String {
    if let Some(start) = expanded.find('{') {
        let after = &expanded[start + 1..];
        let segment = after.split('}').next().unwrap_or(after);
        let mut parts = segment.split('=');
        let _strong = parts.next();
        if let Some(lemma) = parts.next() {
            let trimmed = lemma.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    for part in expanded.split(['/', '\\']) {
        let clean = part.trim_matches(['{', '}']);
        let mut fields = clean.split('=');
        let _strong = fields.next();
        if let Some(lemma) = fields.next() {
            let trimmed = lemma.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    String::new()
}

fn first_non_empty<'a>(values: &[Option<&'a &str>]) -> &'a str {
    for value in values {
        if let Some(value) = value {
            let trimmed = value.trim();
            if !trimmed.is_empty() && trimmed != "~~" {
                return trimmed;
            }
        }
    }
    ""
}

fn parse_reference(raw: &str) -> Option<(i64, i64, i64)> {
    let before_hash = raw.split('#').next().unwrap_or(raw);
    let reference = before_hash
        .split_once('_')
        .map(|(_, value)| value)
        .unwrap_or(before_hash);
    let clean = strip_brackets(reference);
    let mut parts = clean.split('.');
    let book_code = parts.next()?;
    let chapter = parse_leading_int(parts.next()?)?;
    let verse = parse_leading_int(parts.next()?)?;
    let book = book_number(book_code)?;
    Some((book, chapter, verse))
}

fn strip_brackets(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut depth = 0usize;
    for ch in input.chars() {
        match ch {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out
}

fn parse_leading_int(value: &str) -> Option<i64> {
    let digits: String = value
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse::<i64>().ok()
    }
}

fn book_number(code: &str) -> Option<i64> {
    let code = code.trim();
    Some(match code {
        "Gen" => 1,
        "Exo" => 2,
        "Lev" => 3,
        "Num" => 4,
        "Deu" => 5,
        "Jos" => 6,
        "Jdg" => 7,
        "Rut" => 8,
        "1Sa" => 9,
        "2Sa" => 10,
        "1Ki" => 11,
        "2Ki" => 12,
        "1Ch" => 13,
        "2Ch" => 14,
        "Ezr" => 15,
        "Neh" => 16,
        "Est" => 17,
        "Job" => 18,
        "Psa" => 19,
        "Pro" => 20,
        "Ecc" => 21,
        "Sng" => 22,
        "Isa" => 23,
        "Jer" => 24,
        "Lam" => 25,
        "Ezk" => 26,
        "Dan" => 27,
        "Hos" => 28,
        "Jol" => 29,
        "Amo" => 30,
        "Oba" => 31,
        "Jon" => 32,
        "Mic" => 33,
        "Nam" => 34,
        "Hab" => 35,
        "Zep" => 36,
        "Hag" => 37,
        "Zec" => 38,
        "Mal" => 39,
        "Mat" => 40,
        "Mrk" => 41,
        "Luk" => 42,
        "Jhn" => 43,
        "Act" => 44,
        "Rom" => 45,
        "1Co" => 46,
        "2Co" => 47,
        "Gal" => 48,
        "Eph" => 49,
        "Php" => 50,
        "Col" => 51,
        "1Th" => 52,
        "2Th" => 53,
        "1Ti" => 54,
        "2Ti" => 55,
        "Tit" => 56,
        "Phm" => 57,
        "Heb" => 58,
        "Jas" => 59,
        "1Pe" => 60,
        "2Pe" => 61,
        "1Jn" => 62,
        "2Jn" => 63,
        "3Jn" => 64,
        "Jud" => 65,
        "Rev" => 66,
        _ => return None,
    })
}

fn transliterate(value: &str) -> String {
    let mut out = String::new();
    for character in value.chars() {
        let lower = character.to_lowercase().next().unwrap_or(character);
        let mapped = match lower {
            'α' => "a",
            'β' => "b",
            'γ' => "g",
            'δ' => "d",
            'ε' => "e",
            'ζ' => "z",
            'η' => "ē",
            'θ' => "th",
            'ι' => "i",
            'κ' => "k",
            'λ' => "l",
            'μ' => "m",
            'ν' => "n",
            'ξ' => "x",
            'ο' => "o",
            'π' => "p",
            'ρ' => "r",
            'σ' | 'ς' => "s",
            'τ' => "t",
            'υ' => "y",
            'φ' => "ph",
            'χ' => "ch",
            'ψ' => "ps",
            'ω' => "ō",
            'ά' => "a",
            'έ' => "e",
            'ή' => "ē",
            'ί' => "i",
            'ό' => "o",
            'ύ' => "y",
            'ώ' => "ō",
            'ϊ' => "i",
            'ϋ' => "y",
            'ΐ' => "i",
            'ΰ' => "y",
            _ => {
                if lower.is_ascii_alphanumeric() {
                    out.push(lower);
                }
                continue;
            }
        };
        out.push_str(mapped);
    }
    out
}
