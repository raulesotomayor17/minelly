#!/usr/bin/env python3
"""Build the bundled word-study database from the three fixed repositories.

Usage:
  python3 scripts/build_wordstudy.py /path/to/wordstudy /path/to/output.sqlite
Expected directories: strongs/strongsgreek.xml, bhs/BHS-with-Strong-no-extended.csv.zip,
bhs/brief_info_StrongNo.csv, tischendorf/text/osisxml/tischendorfmorph.OSIS.xml
"""
from __future__ import annotations

import csv
import html
import io
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

OSIS_BOOKS = {
    "Matt": 40, "Mark": 41, "Luke": 42, "John": 43, "Acts": 44, "Rom": 45,
    "1Cor": 46, "2Cor": 47, "Gal": 48, "Eph": 49, "Phil": 50, "Col": 51,
    "1Thess": 52, "2Thess": 53, "1Tim": 54, "2Tim": 55, "Titus": 56,
    "Phlm": 57, "Heb": 58, "Jas": 59, "1Pet": 60, "2Pet": 61, "1John": 62,
    "2John": 63, "3John": 64, "Jude": 65, "Rev": 66,
}

def element_text(element: ET.Element) -> str:
    return " ".join("".join(element.itertext()).split())

def strong_html(entry: ET.Element, language: str) -> tuple[str, str, str, str, str, str]:
    strongs = entry.attrib.get("strongs", "")
    prefix = "G" if language == "greek" else "H"
    sid = prefix + str(int(strongs)) if strongs.isdigit() else prefix + strongs
    greek = entry.find("greek")
    lemma = greek.attrib.get("unicode", "") if greek is not None else ""
    translit = greek.attrib.get("translit", "") if greek is not None else ""
    pron = ""
    pronunciation = entry.find("pronunciation")
    if pronunciation is not None:
        pron = pronunciation.attrib.get("strongs", "") or element_text(pronunciation)
    definition = element_text(entry.find("strongs_def")) if entry.find("strongs_def") is not None else ""
    derivation = element_text(entry.find("strongs_derivation")) if entry.find("strongs_derivation") is not None else ""
    kjv = element_text(entry.find("kjv_def")) if entry.find("kjv_def") is not None else ""
    parts = [f"<p><strong>{html.escape(sid)}</strong> <span lang=\"{'grc' if language == 'greek' else 'he'}\">{html.escape(lemma)}</span>"
             f"{(' · <em>' + html.escape(translit) + '</em>') if translit else ''}</p>"]
    if pron:
        parts.append(f"<p><b>Pronunciación:</b> {html.escape(pron)}</p>")
    if definition:
        parts.append(f"<p><b>Definición:</b> {html.escape(definition)}</p>")
    if derivation:
        parts.append(f"<p><b>Derivación:</b> {html.escape(derivation)}</p>")
    if kjv:
        parts.append(f"<p><b>KJV:</b> {html.escape(kjv)}</p>")
    return sid, lemma, translit, pron, definition, "".join(parts)

def build(strongs_dir: Path, bhs_dir: Path, tisch_dir: Path, output: Path):
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    con = sqlite3.connect(output)
    con.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE strong_entries(
            id TEXT PRIMARY KEY, language TEXT NOT NULL, lemma TEXT NOT NULL DEFAULT '',
            transliteration TEXT NOT NULL DEFAULT '', pronunciation TEXT NOT NULL DEFAULT '',
            definition TEXT NOT NULL DEFAULT '', derivation TEXT NOT NULL DEFAULT '',
            kjv TEXT NOT NULL DEFAULT '', html TEXT NOT NULL, source TEXT NOT NULL
        );
        CREATE TABLE word_occurrences(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL, strong_number TEXT NOT NULL,
            book INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
            word_order INTEGER NOT NULL, word TEXT NOT NULL, lemma TEXT NOT NULL DEFAULT '',
            transliteration TEXT NOT NULL DEFAULT '', morphology TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX idx_occ_strong ON word_occurrences(strong_number, source, book, chapter, verse);
        CREATE INDEX idx_occ_ref ON word_occurrences(book, chapter, verse, word_order);
        CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    # Strong's Greek XML
    tree = ET.parse(strongs_dir / "strongsgreek.xml")
    root = tree.getroot()
    count = 0
    for entry in root.findall(".//entry"):
        sid, lemma, translit, pron, definition, rendered = strong_html(entry, "greek")
        derivation = element_text(entry.find("strongs_derivation")) if entry.find("strongs_derivation") is not None else ""
        kjv = element_text(entry.find("kjv_def")) if entry.find("kjv_def") is not None else ""
        con.execute("INSERT OR REPLACE INTO strong_entries VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (sid, "greek", lemma, translit, pron, definition, derivation, kjv, rendered,
                     "morphgnt/strongs-dictionary-xml (CC0)"))
        count += 1
    # Hebrew brief lexicon and BHS occurrences
    hebrew = {}
    with open(bhs_dir / "brief_info_StrongNo.csv", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.reader(f, delimiter="\t")
        for row in reader:
            if len(row) < 6 or not row[0].startswith("H"):
                continue
            sid, pos, lemma, translit, pron, gloss = row[:6]
            hebrew[sid] = (lemma, translit, pron, gloss, pos)
            rendered = (f"<p><strong>{html.escape(sid)}</strong> <span lang=\"he\">{html.escape(lemma)}</span>"
                        f" · <em>{html.escape(translit)}</em></p><p><b>Definición:</b> {html.escape(gloss)}</p>")
            con.execute("INSERT OR REPLACE INTO strong_entries VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (sid, "hebrew", lemma, translit, pron, gloss, "", "", rendered,
                         "BHS-Strong-no (ETCBC/CC BY)"))
            count += 1
    con.commit()

    # Tischendorf OSIS
    current_verse = None
    current_book = 0
    current_chapter = 0
    word_order = 0
    tisch_count = 0
    for event, element in ET.iterparse(tisch_dir / "text/osisxml/tischendorfmorph.OSIS.xml", events=("end",)):
        if element.tag.endswith("verse"):
            sid = element.attrib.get("sID")
            if sid:
                parts = sid.split(".")
                if len(parts) == 3:
                    current_book = OSIS_BOOKS.get(parts[0], 0)
                    current_chapter = int(parts[1])
                    current_verse = int(parts[2])
                    word_order = 0
            element.clear()
            continue
        if not element.tag.endswith("w"):
            continue
        if not current_verse:
            element.clear(); continue
        word = "".join(element.itertext()).strip()
        if not word:
            element.clear(); continue
        lemma_attr = element.attrib.get("lemma", "")
        morph = element.attrib.get("morph", "")
        strong = ""
        lemma = ""
        for part in lemma_attr.split():
            if part.startswith("strong:"):
                raw = part.split(":", 1)[1]
                if raw and raw[0] in "GH" and raw[1:].isdigit():
                    strong = raw[0] + str(int(raw[1:]))
            elif part.startswith("lemma:"):
                lemma = part.split(":", 1)[1]
        if strong:
            word_order += 1
            con.execute("INSERT INTO word_occurrences(source,strong_number,book,chapter,verse,word_order,word,lemma,morphology) VALUES (?,?,?,?,?,?,?,?,?)",
                        ("tischendorf", strong, current_book, current_chapter, current_verse,
                         word_order, word, lemma, morph))
            tisch_count += 1
        element.clear()
    con.commit()

    # BHS CSV
    bhs_count = 0
    with zipfile.ZipFile(bhs_dir / "BHS-with-Strong-no-extended.csv.zip") as z:
        with z.open("BHS-with-Strong-no-extended.csv") as f:
            text = io.TextIOWrapper(f, encoding="utf-8-sig", errors="replace")
            reader = csv.reader(text, delimiter="\t")
            next(reader, None)
            last_ref = None
            order = 0
            for row in reader:
                if len(row) < 4:
                    continue
                match = re.search(r"〔(\d+)｜(\d+)｜(\d+)｜(\d+)〕", row[1])
                if not match:
                    continue
                book, chapter, verse = (int(match.group(i)) for i in (2, 3, 4))
                raw = row[2]
                clean = re.sub(r"<[Hh]>", "", raw).strip()
                if not clean:
                    continue
                strong = row[3].strip()
                if not strong.startswith("H"):
                    continue
                ref = (book, chapter, verse)
                if ref != last_ref:
                    order = 0; last_ref = ref
                order += 1
                lemma, translit, _pron, _gloss, pos = hebrew.get(strong, ("", "", "", "", ""))
                con.execute("INSERT INTO word_occurrences(source,strong_number,book,chapter,verse,word_order,word,lemma,transliteration,morphology) VALUES (?,?,?,?,?,?,?,?,?,?)",
                            ("bhs", strong, book, chapter, verse, order, clean, lemma, translit, pos))
                bhs_count += 1
    con.execute("INSERT OR REPLACE INTO meta VALUES ('version','1')")
    con.execute("INSERT OR REPLACE INTO meta VALUES ('built_at', datetime('now'))")
    con.commit()
    con.execute("VACUUM")
    con.close()
    print(f"strong_entries={count} tischendorf={tisch_count} bhs={bhs_count} -> {output} ({output.stat().st_size/1024/1024:.1f} MB)")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    base = Path(sys.argv[1])
    build(base / "strongs", base / "bhs", base / "tischendorf", Path(sys.argv[2]))
