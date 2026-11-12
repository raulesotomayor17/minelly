#!/usr/bin/env python3
"""Auto-sanación estructural de DOCX/EPUB para el Constructor PBB.

Solo usa la biblioteca estándar. Modifica el archivo en sitio.
"""
import collections
import re
import shutil
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
INVISIBLE = dict.fromkeys(map(ord, "\u00ad\u200b\ufeff"), None)
PAGE = re.compile(r"^\s*(?:pág\.?|p\.?|page)?\s*(?:\d{1,4}|[ivxlcdm]{1,12})\s*$", re.I)
BIBLE = re.compile(r"\b(?:Gn|Éx|Ex|Lv|Nm|Dt|Jos|Jue|Rt|1S|2S|1R|2R|1Cr|2Cr|Esd|Neh|Est|Job|Sal|Pr|Ec|Cant|Is|Jer|Lm|Ez|Dn|Os|Jl|Am|Abd|Jon|Mi|Nah|Hab|Sof|Hag|Zac|Mal|Mt|Mc|Lc|Jn|Hch|Ro|1Co|2Co|Gá|Ef|Fil|Col|1Ts|2Ts|1Ti|2Ti|Tit|Flm|Heb|Stg|1P|2P|1Jn|2Jn|3Jn|Jud|Ap)\s*\d+", re.I)


def paragraph_text(p):
    return "".join(t.text or "" for t in p.iter(W + "t")).replace("\u00ad", "").replace("\u200b", "").replace("\ufeff", "")


def heading_style(p):
    st = p.find(f".//{W}pStyle")
    return st is not None and bool(re.search(r"heading|t[íi]tulo|ttulo|title", st.get(W + "val", ""), re.I)) or p.find(f".//{W}outlineLvl") is not None


def has_image(p):
    return p.find(f".//{W}drawing") is not None or p.find(f".//{W}pict") is not None


def clean_docx(path):
    with zipfile.ZipFile(path) as zin:
        xml = zin.read("word/document.xml")
        root = ET.fromstring(xml)
        body = root.find(W + "body")
        if body is None:
            return 0
        paras = [p for p in body.findall(W + "p")]
        # frecuencia de líneas cortas para detectar running headers
        counts = collections.Counter()
        for p in paras:
            text = re.sub(r"\s+", " ", paragraph_text(p)).strip()
            if 0 < len(text) <= 85 and not BIBLE.search(text):
                counts[re.sub(r"\d+", "#", text.lower())] += 1
        repeated = {k for k, n in counts.items() if n >= 4}
        changed = 0
        previous = None
        for p in paras:
            text = re.sub(r"\s+", " ", paragraph_text(p)).strip()
            style_heading = heading_style(p)
            # encabezado vacío -> párrafo normal o eliminado
            if style_heading and not text:
                for el in list(p):
                    tag = el.tag.split("}")[-1]
                    if tag in ("pStyle", "outlineLvl"):
                        p.remove(el)
                if not has_image(p):
                    body.remove(p)
                changed += 1
                continue
            key = re.sub(r"\d+", "#", text.lower())
            # números de página y running headers
            if PAGE.match(text) or (0 < len(text) <= 85 and key in repeated and not BIBLE.search(text) and not style_heading):
                if not has_image(p):
                    body.remove(p)
                changed += 1
                continue
            # unir runs contiguos con propiedades idénticas
            runs = p.findall(W + "r")
            for a, b in zip(runs, runs[1:]):
                pa, pb = a.find(W + "rPr"), b.find(W + "rPr")
                pa_xml = ET.tostring(pa) if pa is not None else b""
                pb_xml = ET.tostring(pb) if pb is not None else b""
                if pa_xml == pb_xml:
                    at, bt = a.find(W + "t"), b.find(W + "t")
                    if at is not None and bt is not None:
                        at.text = (at.text or "") + (bt.text or "")
                        p.remove(b)
                        changed += 1
            # costura de párrafos partidos
            if previous is not None and text and previous[1] and re.search(r"[a-záéíóúüñ,;:]\s*$", previous[1]) and re.match(r"^[a-záéíóúüñ]", text):
                pt = previous[0].find(W + "t")
                if pt is not None:
                    pt.text = (pt.text or "").rstrip() + " " + text
                    p_text_nodes = p.findall(W + "t")
                    for t in p_text_nodes:
                        t.text = ""
                    changed += 1
            if text:
                previous = (p, text)
        out = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, out if item.filename == "word/document.xml" else zin.read(item.filename))
    shutil.move(tmp, path)
    return changed


def clean_epub(path):
    changed = 0
    tmp = path.with_suffix(path.suffix + ".tmp")
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.endswith((".xhtml", ".html", ".htm")):
                text = data.decode("utf-8", "ignore")
                text = re.sub(r"<p[^>]*>\s*(?:pág\.?|p\.?|page)?\s*\d{1,4}\s*</p>", "", text, flags=re.I)
                data = text.encode("utf-8")
                changed += 1
            zout.writestr(item, data)
    shutil.move(tmp, path)
    return changed


def main():
    if len(sys.argv) != 2:
        print("uso: clean_book_source.py ARCHIVO.docx|epub", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"no existe: {path}", file=sys.stderr)
        return 2
    suffix = path.suffix.lower()
    changed = clean_docx(path) if suffix == ".docx" else clean_epub(path) if suffix == ".epub" else 0
    print(f"Auto-sanación: {changed} imperfecciones corregidas en {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
