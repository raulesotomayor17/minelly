#!/usr/bin/env python3
"""Build the factory interlinear bundle from the user's catalog.

Usage: python3 scripts/build_factory_interlinear.py [source.sqlite] [output.gz]
The source catalog is only read; the output contains:
  resources + verses (RVR1960), interlinear_tokens with spanish_gloss,
  strong_entries, dictionary (Strong-PLUS + STEPBible).
"""
from __future__ import annotations
import gzip, os, re, sqlite3, sys, tempfile

source = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.local/share/com.teoamoxtli.desktop/catalog.sqlite")
output = sys.argv[2] if len(sys.argv) > 2 else "src-tauri/resources/interlinear_factory.sqlite.gz"
BIBLE_ID = "esword:01-rvr1960.bbli"
LEXICON_IDS = ("mysword:strong-plus.dct.mybible", "stepbible:lexicon")

def gloss_from_definition(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    for marker in ("—", "–", "-"):
        if marker in text:
            text = text.split(marker, 1)[1]
            break
    text = re.split(r"[.;:]", text, 1)[0]
    words = re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+", text)
    return " ".join(words[:3]) or ""

with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tmp:
    temp = tmp.name
try:
    src = sqlite3.connect(source)
    dst = sqlite3.connect(temp)
    dst.executescript("""
      PRAGMA journal_mode=OFF;
      CREATE TABLE interlinear_tokens (
        id INTEGER, resource_id TEXT, book INTEGER, chapter INTEGER, verse INTEGER,
        word_order INTEGER, surface_text TEXT, original_manuscript TEXT,
        transliteration TEXT, lemma TEXT, strong_number TEXT, morphology_code TEXT,
        spanish_gloss TEXT
      );
      CREATE TABLE strong_entries (
        id TEXT PRIMARY KEY, language TEXT, lemma TEXT, transliteration TEXT,
        pronunciation TEXT, definition TEXT, derivation TEXT, kjv TEXT, html TEXT, source TEXT
      );
      CREATE TABLE resources (
        id TEXT PRIMARY KEY, kind TEXT, title TEXT, abbreviation TEXT, language TEXT,
        source_format TEXT, source_path TEXT, verse_count INTEGER, entry_count INTEGER,
        imported_at INTEGER, metadata TEXT, indexed INTEGER, search_priority INTEGER
      );
      CREATE TABLE verses (
        resource_id TEXT, book INTEGER, chapter INTEGER, verse INTEGER, html TEXT,
        PRIMARY KEY(resource_id, book, chapter, verse)
      );
      CREATE TABLE dictionary (resource_id TEXT, topic TEXT, html TEXT, PRIMARY KEY(resource_id, topic));
    """)
    dst.execute("ATTACH DATABASE ? AS src", (source,))
    # Strong gloss map
    glosses = {}
    for rid, definition, lemma in src.execute("SELECT id, definition, lemma FROM strong_entries"):
        glosses[rid] = gloss_from_definition(definition) or (lemma or "")
    # Prefer the Spanish Strong-PLUS definition when available.
    spanish = {}
    for topic, html in src.execute("SELECT topic, html FROM dictionary WHERE resource_id='mysword:strong-plus.dct.mymbible'".replace('mymbible','mybible')):
        plain = re.sub(r"<[^>]+>", " ", html or "").replace("&nbsp;", " ")
        if "—" in plain:
            tail = plain.rsplit("—", 1)[-1]
            tail = re.split(r"[.;:]", tail, 1)[0]
            words = re.findall(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+", tail)
            if words:
                spanish[topic.upper()] = " ".join(words[:3])
    glosses.update(spanish)
    total = src.execute("SELECT count(*) FROM interlinear_tokens").fetchone()[0]
    print(f"tokens: {total:,}")
    cursor = src.execute("""SELECT id,resource_id,book,chapter,verse,word_order,surface_text,
        original_manuscript,transliteration,lemma,strong_number,morphology_code
        FROM interlinear_tokens""")
    batch=[]
    for row in cursor:
        strong = (row[10] or "").upper()
        m = re.match(r"([GH])0*(\d+)", strong)
        key = f"{m.group(1)}{m.group(2)}" if m else strong
        gloss = glosses.get(key) or glosses.get(strong) or (row[9] or "") or (row[6] or "")
        if key == "H853" or strong in ("H853", "H0853"):
            gloss = "[marcador de objeto]"
        batch.append((*row, gloss))
        if len(batch) >= 5000:
            dst.executemany("INSERT INTO interlinear_tokens VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
            batch.clear()
    if batch:
        dst.executemany("INSERT INTO interlinear_tokens VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", batch)
    dst.execute("INSERT INTO strong_entries SELECT * FROM src.strong_entries")
    dst.execute("INSERT INTO resources SELECT * FROM src.resources WHERE id=?", (BIBLE_ID,))
    dst.execute("INSERT INTO verses SELECT * FROM src.verses WHERE resource_id=?", (BIBLE_ID,))
    placeholders = ",".join("?" for _ in LEXICON_IDS)
    dst.execute(f"INSERT OR IGNORE INTO resources SELECT * FROM src.resources WHERE id IN ({placeholders})", LEXICON_IDS)
    dst.execute(f"INSERT OR IGNORE INTO dictionary SELECT * FROM src.dictionary WHERE resource_id IN ({placeholders})", LEXICON_IDS)
    dst.commit()
    dst.execute("DETACH DATABASE src")
    dst.close(); src.close()
    with open(temp, "rb") as inp, gzip.open(output, "wb", compresslevel=9) as out:
        while True:
            chunk = inp.read(1024 * 1024)
            if not chunk: break
            out.write(chunk)
    print(f"written: {output} ({os.path.getsize(output)/1024/1024:.1f} MiB)")
finally:
    try: os.unlink(temp)
    except OSError: pass
