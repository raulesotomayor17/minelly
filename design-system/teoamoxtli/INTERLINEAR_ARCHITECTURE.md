# Motor interlineal inverso

## Fuentes analizadas

### STEPBible Data (Tyndale House)

`STEPBible-Data-master.zip` contiene:

- `TAGNT Mat-Jhn` y `TAGNT Act-Rev`: Nuevo Testamento griego palabra por palabra.
- `TBESG` / `TBESH`: lexicones abreviados griego/hebreo.
- `TEGMC` / `TEHMC`: expansión de códigos morfológicos.
- `TOTHT`: Antiguo Testamento hebreo etiquetado.
- `TTESV`: etiquetas de traducción para ESV.

El archivo TAGNT tiene 16 columnas; la columna 11 contiene una **glosa en
español** por palabra, además de:

| Columna | Dato |
| --- | --- |
| 2 | texto griego |
| 3 | traducción inglesa |
| 4 | número de Strong |
| 5 | morfología |
| 6 | lema |
| 11 | glosa española |

Licencia: **CC BY 4.0**. Se debe atribuir a STEPBible.org/Tyndale House.

Importación probada:

```text
151,026 tokens
27 libros
7,957 versículos
```

### OSHB / morphhb

`morphhb-master.zip` contiene XML OSIS por libro con:

```xml
<w lemma="430" morph="HNcmpa">אֱלֹהִ֑ים</w>
```

Aporta hebreo, lema, morfología y Strong. **No contiene texto español
alineado**, por lo que no basta por sí solo para un interlineal inverso en
español. Licencia CC BY 4.0.

### Xiphos

`xiphos-master.zip` es el código fuente del frontend SWORD, no una base de
datos. Sirve como referencia para módulos OSIS/SWORD con etiquetas `<w>`, pero
no aporta tokens listos para importar.

### Berean Bible

La página oficial de descargas ofrece BSB/BIB en PDF, DOCX, Word, texto,
USFM/USJ/USX y EPUB. **No publica CSV/XML del Interlinear Bible** ni una versión
en español del interlineal. El Berean Interlinear Bible es del NT en inglés.
Por tanto, no se puede usar directamente como fuente de un interlineal inverso
en español; sí se podría importar un DOCX/PDF descargado por el usuario en una
fase posterior, respetando su licencia.

## Esquema implementado

```sql
CREATE TABLE interlinear_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id TEXT NOT NULL,
  book INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  word_order INTEGER NOT NULL,
  surface_text TEXT NOT NULL,
  original_manuscript TEXT NOT NULL,
  transliteration TEXT NOT NULL,
  lemma TEXT NOT NULL,
  strong_number TEXT NOT NULL,
  morphology_code TEXT NOT NULL
);
```

El recurso lógico es `stepbible:tagnt`.

## Flujo

```text
ZIP STEPBible
  → parser TAGNT (columnas tabuladas)
  → tokens por libro/capítulo/versículo/palabra
  → SQLite
  → get_interlinear_chapter
  → InterlinearVerse (Flexbox columnar)
```

## UI

- Modo **Interlineal** en el lector.
- Cada palabra es una columna con capas:
  - texto superficial español
  - manuscrito griego
  - transliteración
  - lema
  - Strong
  - morfología
- Menú **Capas** con toggles persistidos en
  `localStorage["teoamoxtli.interlinear-options.v1"]`.
- Clic en Strong abre el panel de diccionario con el número Strong como tema.

## Límites

- El importador cubre el **NT griego**. El AT hebreo requiere alinear el texto
  español con OSHB/TOTHT; no se debe inventar esa alineación.
- La glosa española de TAGNT es una ayuda léxica, no una traducción completa.
- Para el lexicón completo hace falta importar TBESG/TBESH y enlazar `G####` /
  `H####` al panel de diccionario.
- No se redistribuyen los datos: el usuario importa su copia de STEPBible.
