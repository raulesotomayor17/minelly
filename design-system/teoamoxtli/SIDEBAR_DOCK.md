# Dock de barra lateral

## Comportamiento

La barra lateral funciona como un dock movible, inspirado en la barra de
tareas de Windows.

Posiciones:

- izquierda
- derecha
- arriba
- abajo

Estados:

- **Expandida**: navegación con iconos y etiquetas.
- **Contraída**: solo iconos (58 px en lateral, 40 px en horizontal).
- **Auto-ocultar**: se retrae fuera del borde y muestra una manija `☰` en el
  centro del borde correspondiente. Se revela con clic o al pasar el ratón.

Persistencia:

```text
localStorage["teoamoxtli.sidebar.v1"]
{ "position": "left", "collapsed": false, "autoHide": false }
```

## Layout

El `app-shell` usa CSS Grid con áreas:

```css
.app-shell.sidebar-pos-left {
  grid-template-columns: 218px minmax(0, 1fr);
  grid-template-areas: "side main";
}
.app-shell.sidebar-pos-top {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 54px minmax(0, 1fr);
  grid-template-areas: "side" "main";
}
```

En horizontal, la navegación pasa a `display:flex` con scroll horizontal; los
recursos y el pie se compactan.

Auto-ocultar colapsa la pista del grid a `0` y oculta la barra con
`visibility:hidden`/`opacity:0`; la manija queda fija en el borde.

## Contraste

Cada tema tiene un degradado propio para el dock, borde y sombra:

- Glass: azul-violeta translúcido.
- Azul: azul medianoche.
- Gris: grafito.
- Verde: bosque.
- Blanco: blanco con borde frío.

El dock tiene `z-index: 60` para que su menú de configuración quede por encima
del topbar del lector.

## Controles

- `⋮` abre posición, auto-ocultar y restablecer.
- `«` contrae la barra; `»` la expande.
- En horizontal, el pie queda a la derecha y la navegación se desplaza si no
  cabe.

## Pruebas

- Izquierda: `218px + 782px`.
- Derecha: `782px + 218px`.
- Arriba: `54px + 506px`, navegación en flex.
- Abajo: `506px + 54px`.
- Contraída abajo: `40px`, etiquetas en `display:none`.
- Auto-ocultar abajo: fila del dock `0px`, manija visible, `visibility:hidden`.
- Revelado: vuelve a `40px`, `visibility:visible`.
