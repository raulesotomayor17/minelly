# Motor de formato bíblico

## Objetivo

Cambiar la presentación del texto sin volver a consultar SQLite ni recargar el
capítulo. Los nodos de los versículos se conservan; el contenedor recibe clases
CSS.

## Store

`src/bibleFormatStore.ts` usa Zustand con `persist`.

```ts
interface BibleFormatOptions {
  enableCustomFormatting: boolean;
  showBibleFormatting: boolean;
  showChapterVerseNumbers: boolean;
  showFootnoteIndicators: boolean;
  showNonBiblicalText: boolean;
  oneVersePerLine: boolean;
}
```

Persistencia: `localStorage["teoamoxtli.bible-format.v1"]`.

## Contenedor

```tsx
<section className={`reader ${bibleFormatClass}`}>
```

Clases:

| Clase | Efecto |
| --- | --- |
| `hide-numbers` | Oculta `.verse-number` y `.chapter-heading` |
| `hide-footnotes` | Oculta `.note` y `.xref` |
| `hide-headings` | Oculta títulos y perícopas |
| `verse-by-verse` | Una fila grid por versículo |
| `paragraph-mode` | Filas y textos en `display:inline` |
| `plain-formatting` | Elimina cursivas/sangrías editoriales |
| `default-formatting` | Formato original cuando el interruptor general está apagado |

## Menú

El botón **Formato** abre `.format-popover` con:

1. Interruptor **Formato personalizado**.
2. Sección **Texto bíblico**:
   - Formato de texto de la Biblia.
   - Números de capítulo/versículo.
   - Indicadores de pie de página.
   - Texto no bíblico y títulos.
   - Un versículo por línea.
3. **Restablecer formato**.

El popover cierra al hacer clic fuera o con `Escape`.

## Compatibilidad

- El botón `123` escribe `showChapterVerseNumbers` en el mismo store.
- Cargar un entorno guardado escribe `showNumbers` en el store.
- Los modos página y libro completo respetan las mismas clases.
- No se ejecuta ninguna consulta a la base de datos al cambiar una opción.

## Pruebas

- 36 filas antes y después de pasar a párrafo; `display:inline`.
- Números ocultos en párrafo: `display:none`.
- Interruptor general deshabilitado: checkboxes anidados deshabilitados.
- Restablecer devuelve todos los valores a `true`.
- Persistencia verificada en `localStorage`.
