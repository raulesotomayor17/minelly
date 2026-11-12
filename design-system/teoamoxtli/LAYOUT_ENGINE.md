# Motor de layouts modulares

Implementación en [ModularWorkspace.tsx](../src/ModularWorkspace.tsx) del
esquema `modular_workspace_layout_engine` para Teoamoxtli.

## Modelo

```ts
type PaneType = "bible" | "commentary" | "dictionary" | "book";
type LinkSet = "A" | "B" | "C" | "D" | "E" | "F" | "none";
type SplitDirection = "horizontal" | "vertical";

interface PaneNode {
  type: "pane";
  id: string;
  resourceType: PaneType;
  linkSet: LinkSet;
  state: {
    resourceId: string;
    reference: { book: number; chapter: number; verse: number };
    topic?: string;
    spine?: number;
  };
}

interface SplitNode {
  type: "split";
  id: string;
  direction: SplitDirection;
  ratio: number; // 0.18 – 0.82
  children: [LayoutNode, LayoutNode];
}

type LayoutNode = PaneNode | SplitNode;
```

El árbol es binario y recursivo, igual que el `root_container` del esquema. Un
`split` divide el viewport en dos; un `pane` es una hoja con un recurso.

## Operaciones

| Operación | Implementación |
| --- | --- |
| `split_pane` | `splitPane(tree, paneId, direction, newType, resources)` |
| `close_pane` | `closePane(tree, paneId)`; el hermano ocupa el lugar |
| `resize_split` | `resizeSplit(tree, splitId, ratio)` con arrastre del divisor |
| `swap_panes` | `swapWithNext(tree, paneId)` intercambia con el siguiente panel |
| `float_pane` | `floatPane(paneId)` saca el panel del árbol a `floating[]` |
| `dock_pane` | `dockPane(paneId, side)` reinserta el panel flotante |
| `dock_all` | `dockAllFloating()` acopla todas las ventanas flotantes |
| `add_pane` | `addPane("docked" | "floating")` añade un panel nuevo |
| `layout_preset` | `applyLayoutPreset("study" | "bible-commentary" | "compare" | "bible")` |

Los botones del encabezado de cada panel acoplado son:

- `⧉` sacar a ventana flotante.
- `⇔` dividir horizontalmente.
- `⇕` dividir verticalmente.
- `⇄` intercambiar con el siguiente panel.
- `×` cerrar y colapsar el hermano.

La ventana flotante tiene una barra propia con `⇤ Izq.`, `Der. ⇥` y `×`.
Se arrastra desde la barra y se redimensiona desde la esquina inferior derecha.
El modelo guarda `x`, `y`, `width`, `height` y `z`; los perfiles serializan
también `floating[]`.

## Entornos rápidos

- **Estudio:** Biblia + comentario + diccionario.
- **Biblia + comentario:** dos paneles horizontales.
- **Comparar dos Biblias:** dos paneles bíblicos enlazados a A.
- **Solo Biblia:** un único panel.

La barra **Añadir panel** permite crear un panel acoplado o flotante después de
cerrar una ventana. **Reacoplar todo** devuelve todas las ventanas al árbol.

## Sincronización

Los grupos son **A–F** y `—` (independiente). Cada panel de Biblia emite un
evento al hacer scroll o navegar explícitamente. El despachador central:

1. localiza el link set del panel origen;
2. actualiza solo los paneles de ese mismo group;
3. marca los destinos como `programmatic` para ignorar su `onScroll`;
4. no reemite desde los destinos;
5. limpia la bandera tras la navegación.

El evento contiene `sourcePaneId`, `linkSet`, `reference`, `canonicalBook` (OSIS)
y `triggerType` (`explicit_navigation`/`user_scroll`). Esto evita el bucle
Panel 1 → Panel 2 → Panel 1.

`ON_REFERENCE_CHANGE` se implementa con `dispatchLinkEvent`:

1. Se localiza el panel de origen.
2. Se actualiza su `state.reference`.
3. Si su `linkSet` es `A`–`F`, se actualizan todos los paneles con ese mismo
   `linkSet`.
4. Los paneles `none`, el diccionario y los libros no se propagan.
5. No se vuelve a disparar el evento desde los paneles destino; el árbol se
   actualiza en una sola pasada, evitando ciclos.

`setLink` cambia un panel de grupo y lo alinea con la referencia existente del
grupo destino.

## Persistencia

- Los perfiles se guardan en
  `localStorage["teoamoxtli.modular-layouts.v1"]`.
- Cada perfil contiene `name`, `tree`, `readerFont`, `studyFont`,
  `readerScale` y `studyScale`.
- **Guardar** serializa el árbol actual.
- **Exportar** copia el JSON completo al portapapeles nativo de Tauri.
- **Importar** lee el portapapeles y reconstruye el árbol y los perfiles.
- El portapapeles usa `tauri-plugin-clipboard-manager`, no la API del navegador,
  para no depender del foco del documento.

Formato exportado:

```json
{
  "version": 1,
  "tree": { "type": "split", "direction": "horizontal", "ratio": 0.62, "children": [] },
  "profiles": [],
  "readerFont": "Literata",
  "studyFont": "Crimson Pro"
}
```

## Paneles

| Tipo | Datos | Fuente |
| --- | --- | --- |
| Biblia | `get_passage` | fuente de lectura global |
| Comentario | `get_commentaries` | fuente y escala de estudio |
| Diccionario | `dictionary_topics`, `lookup_dictionary` | fuente y escala de estudio |
| Libro | `epub_chapters`, `get_epub_chapter` | fuente de lectura global |

## Límites actuales

- Es un **tiling manager** de árbol binario; todavía no hay drag-and-drop para
  arrastrar pestañas entre paneles ni acoplamiento flotante.
- La escala tipográfica es global para lectura y estudio; no hay una escala
  independiente por panel.
- La persistencia es local (`localStorage`), no una tabla SQLite ni un archivo
  de configuración externo.
- No crea varias ventanas del sistema operativo; los "entornos" son
  disposiciones dentro de la ventana.
- El motor está probado en Windows. Linux/macOS siguen pendientes.

## Relación con la interfaz clásica

`Lienzo` abre el editor modular como una capa de pantalla completa. `Volver`
regresa al lector clásico. El lector clásico conserva sus selectores de fuente y
tamaño para Biblia, comentario y diccionario.
