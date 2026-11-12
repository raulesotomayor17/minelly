# Comparador de versiones

## Arquitectura

- **Una fila por versículo**, no columnas con scroll independiente.
- Grilla CSS dinámica:

```css
.compare-row,
.compare-header {
  display: grid;
  grid-template-columns: 50px repeat(var(--col-count), minmax(190px, 1fr));
}
```

`--col-count` se actualiza con el array de versiones. El ancho mínimo produce
scroll horizontal global cuando hay muchas columnas; nunca hay `overflow-y`
por columna.

- **Scroll único** en `.compare-scroll` (`overflow: auto`).
- Cabecera `position: sticky; top: 0`.
- Primera columna = base; las demás se comparan contra ella.
- Se pueden añadir/quitar versiones mientras queden al menos dos.

## Diff

Se normalizan tokens (minúsculas y puntuación) y se calcula el LCS
palabra por palabra.

- `unchanged`: mismo token.
- `deleted`: palabra de la base que no está en la versión comparada.
- `added`: palabra nueva de la versión comparada.

Porcentaje:

```text
edits = baseLen + otherLen - 2 * lcs
porcentaje = round(edits / (baseLen + otherLen) * 100)
```

Así no se satura en 100% cuando hay muchas adiciones.

## Contrato de datos

El componente interno usa:

```ts
interface CompareRow {
  verseNumber: number;
  columns: {
    resourceId: string;
    version: string;
    isBase: boolean;
    diffPercentage: number;
    tokens: { type: "unchanged" | "deleted" | "added"; text: string }[];
  }[];
}
```

En la app, `CompareWorkspace` construye las filas desde `get_passage` para cada
Biblia seleccionada, alineando por número de versículo. Para usar datos externos,
basta mapear el JSON de entrada a `CompareRow[]` y pasar el array al render.

## UI

- Cabecera sticky con selector de versión por columna.
- Columna base marcada con `Base`.
- Filas alternas translúcidas.
- Texto eliminado gris y tachado.
- Texto añadido cian.
- Porcentaje bajo cada versículo no base.
- Interruptores independientes **Mostrar diferencias** y **Mostrar %**.
- Ambos apagados: texto limpio, sin marcas ni porcentajes.
- Selector de **versículo inicial**; `Todos` muestra el capítulo completo.
  Al entrar desde el lector se usa el versículo activo.
- Preferencias persistidas en `localStorage["teoamoxtli.compare-diff"]` y
  `localStorage["teoamoxtli.compare-percentages"]`.
- Glassmorphism en el overlay y cabecera.

## Pruebas

- 5 Biblias locales, Juan 3, 36 filas.
- Grilla calculada: `50px + 5 × 190px`.
- Scroll vertical global; sin scroll por columna.
- Añadir/quitar versión mantiene la alineación.
- Porcentajes variados; antes la fórmula saturaba en 100%.
- Capturas: `shot-comparator-verse-final.png`, `shot-comparator-toggles.png`,
  `shot-comparator-clean.png`, `shot-comparator-final2.png`.

## Límites

- Diff léxico, no semántico.
- El LCS es O(n×m) por versículo; adecuado para versículos, no para capítulos
  completos en una sola celda.
- Las palabras muy distintas por traducción pueden mostrar bastante texto
  eliminado/añadido; es el comportamiento esperado del diff contra la base.
