# Minelly · propuesta de identidad

Propuesta 01 para **Minelly Bible Software**. Siete páginas: decisión de nombre,
posicionamiento, tres rutas de logotipo, sistema visual, aplicación y siguientes pasos.

## Archivos

| Archivo | Qué es |
|---|---|
| `Minelly-propuesta.pdf` | La propuesta completa, A4, texto seleccionable |
| `propuesta.html` | Fuente de la propuesta (se imprime a PDF con WeasyPrint) |
| `logos/*.svg` | Logotipos e iconos, fuente editable |
| `logos/*-curvas.svg` | Los mismos, con el texto convertido a contornos (sin depender de fuentes) |
| `preview/*.png` | Anticipos y páginas rasterizadas para revisión rápida |

## Rutas

- **A · Monograma editorial** — M de Literata sobre línea de cobre. Recomendada.
- **B · Códice** — libro abierto con separador. Para impresos, splash y mercancía.
- **C · Tipográfico** — el nombre sin símbolo, con punto de cobre. Para documentos y web.

## Reconstruir

```bash
# PDF (WeasyPrint)
python3 -c "from weasyprint import HTML; HTML('propuesta.html', base_url='.').write_pdf('Minelly-propuesta.pdf')"

# PNG de un SVG (VectorCraft, sin abrir la app)
vectorcraft-cli convert logos/lockup-A.svg preview/lockup-A.png --scale 2

# SVG con contornos
vectorcraft-cli convert logos/lockup-A.svg logos/lockup-A-curvas.svg --outline-text
```

## VectorCraft

El servidor MCP existe y arranca en stdio:

```bash
vectorcraft-cli mcp --headless --automation-read-root "$PWD" --automation-write-root "$PWD"
```

Este agente de DSH no monta servidores MCP (solo la capa ACP lo hace), así que el
trabajo se hizo por la CLI, que es la misma superficie de automatización: comandos,
`convert` y exportación. Para un cliente que sí hable MCP (Claude Code, Codex, Cursor),
basta registrar ese comando como servidor `vectorcraft`.

## Notas

- Las fuentes de la propuesta son Literata e Inter, ya embarcadas en la app. Para
  rasterizar con VectorCraft se instalaron los TTF de Literata en
  `~/.local/share/fonts/minelly` (convertidos desde los WOFF2 de `@fontsource`).
- Los dominios `minelly.bible` y `minellybible.com` no resolvían al momento de la
  propuesta; no están reservados. Verificar en el registrador antes de anunciarlos.
- El nombre `Teoamoxtli` queda como edición de patrimonio y nombre interno. El Tzicuri
  se retira con la identidad anterior.
