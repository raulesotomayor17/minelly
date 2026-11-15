# Seguridad

## Reportar una vulnerabilidad

**No abras un issue público** para fallos de seguridad. Usa el canal privado de
GitHub:

1. Entra en <https://github.com/raulesotomayor17/minelly/security/advisories/new>.
2. Describe el impacto, los pasos para reproducirlo y la versión afectada.
3. Si es posible, incluye una prueba de concepto mínima y una propuesta de
   corrección.

También puedes escribir al mantenedor por su perfil de GitHub si el formulario
no está disponible. No envíes claves de API reales, datos de tu biblioteca ni
textos con derechos de autor.

## Qué incluye el alcance

- Ejecución de código o *sandbox escape* en la aplicación de escritorio.
- *Path traversal* o escritura arbitraria durante la importación de módulos,
  EPUB, DOCX o PDF.
- Inyección de HTML/JavaScript en el lector o en los paneles.
- Exposición de la clave de API, del catálogo local o de las notas.
- Descarga o actualización insegura de recursos.
- Permisos de Tauri más amplios de los necesarios.

## Versiones soportadas

| Versión | Soporte |
| --- | --- |
| `0.2.x` (alfa) | Correcciones de seguridad mientras la rama esté activa |
| `< 0.2` | Sin soporte |

## Medidas actuales

- La aplicación es local-first y no incluye telemetría.
- Las claves de API se guardan en el almacenamiento local del usuario; no se
  incluyen en el repositorio.
- Los módulos importados se procesan localmente. El importador no elude DRM.
- La ventana de Tauri declara solo los permisos que necesita (`dialog`,
  `clipboard`, `opener` y control de pantalla completa).
- Las dependencias se revisan con `npm audit` y `cargo audit` cuando es posible.

## Limitaciones conocidas

- La política de seguridad de contenido (CSP) de Tauri está desactivada
  (`csp: null`) para no romper contenido local y recursos de terceros. Esto
  aumenta el impacto de una inyección de HTML. Es una de las prioridades antes
  de la versión 1.0.
- Las compilaciones públicas no están firmadas. Verifica los *checksums* de los
  artefactos antes de instalarlos.
- Las funciones de IA envían el texto que decidas al proveedor que configures.
  Revisa [`PRIVACY.md`](PRIVACY.md).

## Divulgación coordinada

Pedimos un plazo razonable para corregir el fallo antes de publicarlo. Si no hay
respuesta en 14 días, puedes escalar la divulgación de forma responsable,
evitando publicar datos de terceros o una explotación lista para usar.

Gracias por ayudar a que Minelly sea más segura.
