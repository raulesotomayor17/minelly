# Privacidad

Minelly es una aplicación **local-first**. No tiene cuentas, telemetría,
publicidad ni análisis de uso. Esta página explica qué datos se guardan y cuándo
sale algo de tu equipo.

## Datos que se guardan localmente

- El catálogo de recursos importados (`catalog.sqlite`).
- Notas, cuadernos, etiquetas, resaltados y anclajes.
- Sermones, diapositivas y libros personales (PBB).
- Preferencias de interfaz, temas, fuentes y entornos de trabajo.
- Claves de API y configuración del asistente, si decides guardarlas.

Las rutas habituales son:

| Sistema | Carpeta de datos |
| --- | --- |
| Linux | `~/.local/share/com.teoamoxtli.desktop/` |
| Windows | `%APPDATA%\com.teoamoxtli.desktop\` |
| macOS | `~/Library/Application Support/com.teoamoxtli.desktop/` |

La app puede usar una carpeta distinta si se compila con otro identificador
Tauri. Los datos no se sincronizan automáticamente con la nube.

## Claves de API

Las claves de DeepSeek y Pixabay se guardan en el almacenamiento local de la
ventana (`localStorage`) solo si activas la opción de recordarlas. No se envían
a Minelly ni a este repositorio. Si no quieres que persistan, no actives
«recordar» y ciérralas al terminar.

Una clave guardada en `localStorage` puede ser leída por código que se ejecute
en la ventana. Por eso es importante no instalar builds de terceros ni abrir
contenido no confiable.

## Cuándo se conecta a Internet

Minelly funciona sin conexión para leer, buscar, tomar notas y preparar
sermones. Solo hace peticiones externas cuando tú lo pides:

| Función | Destino | Qué se envía |
| --- | --- | --- |
| Asistente de estudio (RAG) | El proveedor que configures (por defecto, API de DeepSeek) | Tu pregunta, los fragmentos de la biblioteca seleccionados y, si se usa, el historial de la conversación. |
| Buscador de imágenes de sermones | Pixabay | El término de búsqueda. |
| Lectura con Qwen3-TTS | Servidor local que configures (`127.0.0.1` por defecto) | El texto del versículo que se va a sintetizar. |
| Enlaces externos | El navegador del sistema | La URL que abras. |

No hay servidores de Minelly que reciban tus datos. Revisa las condiciones y la
política de privacidad de DeepSeek, Pixabay o del proveedor que uses antes de
enviarles contenido.

## Contenido con derechos de autor

Enviar una traducción bíblica, un comentario o un libro a un servicio de IA
puede constituir una reproducción o una comunicación pública según la
jurisdicción. Es tu responsabilidad tener derecho a usar ese contenido. Para
probar la función, usa textos de dominio público o fragmentos propios.

## Datos de menores

La app no está dirigida específicamente a menores ni recopila datos de ellos.
Los datos se quedan en el equipo del usuario.

## Eliminar tus datos

- Cierra la app.
- Haz una copia de seguridad si quieres conservar notas o sermones.
- Elimina la carpeta de datos indicada arriba.
- Si quieres conservar solo la biblioteca, exporta antes tus notas y sermones.

No hay una opción de «borrado remoto» porque no hay servidor.

## Cambios en esta política

Los cambios se registrarán en [`CHANGELOG.md`](CHANGELOG.md). Si una versión
futura añade telemetría o sincronización, se avisará de forma visible y será
opcional.

## Contacto

Para preguntas de privacidad, abre un *issue* sin incluir datos personales o usa
el canal privado de [`SECURITY.md`](SECURITY.md).
