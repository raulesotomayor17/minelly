# Inventario del Lienzo actual

Fecha: 2026-11-11. Fuente de verdad: `design-system/teoamoxtli/lienzo-spec.json` (v2).
Esta fase no modifica `src/`.

## 1. Tipos de panel actuales

`src/ModularWorkspace.tsx` define `PaneType` y `TYPE_LABEL`:

| kind | etiqueta | cuerpo / función | estado que necesita |
|---|---|---|---|
| `bible` | Biblia | `PaneView`, bloque `pane.resourceType === "bible"` | `resourceId`, `reference`, `linkSet`, `readerScale`, `readerFont` |
| `commentary` | Comentario | `PaneView`, bloque `=== "commentary"` | `resourceId`, `reference`, `linkSet`, `studyScale`, `studyFont` |
| `dictionary` | Diccionario | `PaneView`, bloque `=== "dictionary"` | `resourceId`, `topic`, `studyScale` |
| `book` | Libro | `PaneView`, bloque `=== "book"` | `resourceId`, `spine`, `reference` (citas), `studyScale` |
| `interlinear` | Interlineal | `PaneView`, bloque `=== "interlinear"` | `reference`, `linkSet`, `readerScale`, opciones de capas |
| `compare` | Comparador | `PaneView`, bloque `=== "compare"` | `resourceId` base, `compareIds`, `reference`, `showDiff` |
| `notes` | Notas | `PaneView`, bloque `=== "notes"` | `reference`, `linkSet`, notas ancladas |
| `search` | Buscar | `PaneView`, bloque `=== "search"` | `searchQuery`, `linkSet` |
| — | Sermones | `SermonWorkspace` (fuera del Lienzo actual) | no es panel del árbol |
| — | Documentos | `DocumentsWorkspace` (modal) | no es panel del árbol |
| — | Asistente | `StudyAssistant` (modal) | no es panel del árbol |

Los ocho `panelKinds` del contrato existen, pero **Sermones, Documentos, Asistente, Ayuda, Biblioteca, Buscar global y Panel de control no son pestañas**: siguen siendo vistas/modales de nivel superior. Eso contradice `shell.everythingIsATab`.

## 2. Bus de link sets

- Tipos y eventos: `LinkSyncEvent` (`sourcePaneId`, `linkSet`, `reference`, `canonicalBook`, `triggerType`).
- `updateReference()` publica cambios y `dispatchLinkEvent()` los distribuye entre `tree` y `floating`.
- `programmaticPanes` + `syncTimerRef` suprimen ecos durante 500 ms.
- Los grupos válidos son `A`–`F` y `none`.
- Hoy la lista de paneles se obtiene de `collectPanes(tree)` + `floating`; el contrato pide que salga de `dockview.panels`.

## 3. Persistencia actual

- Clave: `teoamoxtli.modular-layouts.v1`.
- Valor: arreglo de `LayoutProfile`:
  `{id,name,createdAt,tree,floating,readerFont,studyFont,readerScale,studyScale}`.
- `tree` es un árbol binario `PaneNode | SplitNode`; `floating` es `FloatingWindow[]`.
- `PaneNode` guarda `tabs`, `activeTabId`, `resourceType`, `linkSet`, `state`.
- No existe `teoamoxtli.dock-layout.v1` ni respaldo `.broken`.
- El motor actual no usa dockview: **no está instalado** en `package.json`.

## 4. Código manual que se reemplazará

Todo en `src/ModularWorkspace.tsx`:

- Modelo de árbol y pestañas: `PaneState`, `PaneTab`, `PaneNode`, `SplitNode`, `LayoutNode`, `FloatingWindow`, `LayoutProfile`.
- Construcción: `makePane`, `buildPresetTree`, `defaultTree`.
- División/cierre/orden: `splitPane`, `closePane`, `swapWithNext`, `resizeSplit`, `insertDocked`.
- Arrastre propio: `startPaneDrag`, `floatPaneAt`, `dockPaneAt`, `moveFloating`, `resizeFloating`, `dockPane`.
- Persistencia/entornos: `loadProfiles`, `saveProfile`, `applyProfile`, `exportProfiles`, `importProfiles`.
- Pestañas y cabecera: barra `.mod-pane-tabs`, selector de tipo, selector de recurso y menú `+`.
- El bus actual se conserva (§2), pero deberá leer paneles desde dockview.

`ModularWorkspace.tsx` tiene ~3.200 líneas; el motor manual está concentrado entre las líneas 100–530 (modelo/helpers), 2050–2450 (acciones) y 2600–3220 (render y flotantes).

## 5. Cuerpos acoplados a `PaneNode`

`PaneView` recibe un `PaneNode` completo y usa:

- `pane.id`, `pane.resourceType`, `pane.linkSet`, `pane.state`.
- Callbacks `onReference`, `onResource`, `onType`, `onLink`, `onPaneState`, `onSplit`, `onClose`, `onSwap`, `onAddTab`, `onSwitchTab`, `onCloseTab`, `onDragStart`, `onFloat`, `onDock`.
- Estado local propio (pasaje, comentario, diccionario, capítulo, búsqueda, notas).

Para montarlo en dockview hay que:

1. Extraer el cuerpo de `PaneView` a un componente que reciba `params` del panel (no un `PaneNode`).
2. Mantener un adaptador que traduzca `params` del contrato (`kind`, `resourceId`, `reference` OSIS, `linkSet`, `scrollTop`, `compareIds`, `fontScale`) al estado que espera cada cuerpo.
3. Sacar del cuerpo la barra de pestañas/cabecera propia: dockview aporta pestañas, cierre, arrastre y menú contextual.
4. Convertir `reference` de `{book,chapter,verse}` a OSIS y viceversa.
5. Sustituir los `<select>` nativos del cuerpo (Biblia, comentario, diccionario, libro) por los controles del contrato (`referenceBox`, cinta y paleta).

## Bloqueos detectados antes de la fase 2

- `dockview` no está instalado.
- El Lienzo sigue siendo una pantalla superpuesta (`showModular`) con botón Volver; `shell` pide que sea el área principal.
- Los paneles de herramienta son modales, no pestañas.
- No existe el feature flag `teoamoxtli.dock-engine`.
- Los perfiles actuales usan árbol binario, no el JSON de dockview.

## Estado de la fase

- Fase 1 completada: inventario y copia del contrato.
- No se modificó `src/` en esta fase, conforme al Prompt 1.
- Fase 2 (dockview) pendiente de autorización/ejecución.
