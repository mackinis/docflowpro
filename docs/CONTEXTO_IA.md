# BITÁCORA DE CONTINUIDAD IA — DocFlow Pro

> **REGLA DE ORO / BREADCRUMB:** Leer `AGENTS.md` antes de intervenir. En cada commit de trabajo dejar `Continuidad-IA: docs/CONTEXTO_IA.md`; actualizar aquí intención, cambios, fallos, pruebas y siguiente paso. Esta bitácora está escrita para la siguiente instancia de ChatGPT.

## Para recuperar el contexto en un chat nuevo
1. Leer `AGENTS.md` y este archivo completos.
2. Consultar **todos los commits nuevos desde la última entrada**, y ampliar al historial anterior cuando haga falta; contrastar con el código vigente.
3. Identificar diferencias entre lo pedido, lo implementado, lo probado, lo desplegado y lo confirmado por el usuario.
4. Preguntar solo por ambigüedades reales; no inventar estado ni dar por resueltos bugs no verificados.

## Arquitectura e intención de producto
DocFlow Pro: aplicación de gestión documental y expedientes/legajos con plantillas digitalizadas, procesos operativos y Confecciones. Stack conocido en conversaciones previas: React/TypeScript y Cloudflare Workers/Hono, D1, R2 y Workers AI. Verificar vigencia en código.

**Decisión fundamental del usuario:** la digitalización es el punto de origen y autoridad del mapa semántico. Identifica cada campo, su actor y significado, lo numera consecutivamente y persiste el mapa. Procesos, Legajos y Confecciones deben consumir esa misma definición, sin repetir la inferencia. El mapa debe estar asociado a la versión exacta de la plantilla; la numeración aislada no es identidad semántica suficiente. Evitar autocompletar con datos inferidos sin evidencia/confirmación.

## Preferencias y restricciones explícitas
- Cambios mínimos y precisos; no romper flujos que ya funcionan.
- Respetar el aspecto original salvo que se solicite cambiarlo.
- No crear editores paralelos, botones ni pasos extra cuando se pide edición directa.
- Reconocer errores y documentar intentos rechazados.
- No afirmar éxito de producción sin compilación, despliegue y prueba correspondientes.

## Entrada inicial — 2026-11-17 — Institución de la regla de oro
**Solicitud:** el usuario quiere que GitHub funcione como bitácora **para otra instancia de ChatGPT** al cambiar de chat, con una pista permanente en cada intervención y commit.

**Acción:** se incorporan `AGENTS.md` y `docs/CONTEXTO_IA.md` con instrucciones explícitas de lectura, actualización y breadcrumb. Esta es la primera entrada; el historial previo sigue en GitHub y debe revisarse cuando corresponda.

**Contexto reciente de alto riesgo:** se trabajó en la digitalización de una hoja guía de contrato de locación, la identificación de campos y su visualización. El usuario rechazó un editor adicional y exigió edición directamente en la vista del documento digitalizado. Commit previo conocido: `0028c6b656213d42a3c9f00590d1314d1e4a1abe`, que intentó implementar edición inline. **No consta compilación ni prueba en producción de ese commit.** Inspeccionar código y comportamiento antes de afirmar que funciona. Se han observado fallos previos en detección de campos innecesarios, numeración y conservación de marcadores al publicar en Documentos; no asumir que estén solucionados.

**Pruebas:** creación de estos archivos de continuidad; no se ha compilado ni desplegado la aplicación como parte de esta intervención.

**Pendiente inmediato:** en la siguiente tarea técnica, inspeccionar el estado real de edición inline, guardado, numeración y mapa; ejecutar validaciones antes de afirmar solución. Registrar cada resultado aquí.

## Formato de las próximas entradas
### AAAA-MM-DD — Tema — commits
- **Pedido/intención del usuario:**
- **Hechos comprobados antes del cambio:**
- **Archivos y cambios:**
- **Errores o enfoques rechazados:**
- **Pruebas ejecutadas y resultado:**
- **Despliegue y confirmación del usuario:**
- **Riesgos / pendientes:**
- **Próximo paso para la siguiente instancia:**

### 2026-11-17 — Eliminar borde amarillo de foco del editor inline — `900fa9025e8540ea66181c9f412e52dff4476991`
- **Pedido/intención del usuario:** quitar el recuadro amarillo alrededor de todo el texto en la vista editable de plantilla, conservando edición directa y resaltado de marcadores.
- **Hechos comprobados antes del cambio:** `src/components/TemplatesManager.tsx`, `renderInlineEditable`, aplicaba `focus:ring-1 focus:ring-amber-400` al contenedor `contentEditable`.
- **Archivos y cambios:** se quitaron únicamente esas dos clases de foco; no se modificaron campos, contenido, numeración ni persistencia.
- **Errores o enfoques rechazados:** no añadir modales, botones ni otra modalidad de edición.
- **Pruebas ejecutadas y resultado:** revisión textual de la clase y sustitución única; sin compilación, navegador ni despliegue verificados.
- **Despliegue y confirmación del usuario:** pendientes.
- **Riesgos / pendientes:** verificar visualmente en producción después del despliegue. El foco del editor ya no tendrá ese contorno visible.
- **Próximo paso para la siguiente instancia:** comprobar comportamiento de edición directa y guardado; no reintroducir borde global amarillo.

### 2026-11-17 — Guardado visible al modificar, salida protegida y mapa oculto — `1e5e44a17d3b505a5e26416c49ccef75022d5176`
- **Pedido/intención del usuario:** quitar botón y sección visibles «Mapa de campos», manteniendo intactos los metadatos semánticos internos; mostrar «Guardar cambios» en la cabecera únicamente ante la mínima edición; advertir con diálogo «Aceptar» (salir sin guardar) y «Cancelar» si intenta cerrar con cambios pendientes; sin aviso si no editó.
- **Hechos comprobados:** `src/components/TemplatesManager.tsx` tenía mapa visible controlado por `visibleMapId`, guardado al pie solo después de `onBlur`, y cierre sin protección. Se inspeccionó el archivo vigente.
- **Cambios:** se eliminó estado/botón/sección visual del mapa; se conservó `tpl.fieldMap` y la lógica de persistencia; captura de cambios con `onInput` y `useRef`, botón contextual de guardado en cabecera, confirmación de salida a través del modal existente, sin añadir editor alternativo.
- **Riesgos:** no se compiló ni probó en navegador; verificar que el editor mantenga el cursor al escribir, que la confirmación solo aparezca con cambios, que guardar persista correctamente y que los marcadores no se alteren. El mapa semántico interno no fue eliminado.
- **Despliegue/confirmación:** no verificados.
- **Próximo paso:** probar funcionalmente; no reintroducir mapa visual ni un segundo botón de guardado.

### 2026-11-18 — Renumeración consecutiva de campos editados — `61cb271`, `72b1cd3`
- **Problema observado por el usuario:** al borrar el marcador [CAMPO_1], el primer marcador visible seguía siendo [CAMPO_2]; se requiere reordenamiento en tiempo real y, como mínimo, al guardar.
- **Causa en código:** el editor de `TemplatesManager.tsx` solo normalizaba identificadores en `saveInlineDocument`; la edición visible no los reenumeraba. La edición previa también requería conservar metadatos por identidad original.
- **Cambio:** `normalizeInlineMarkers` actualiza badges y `data-marker` consecutivamente en `onInput` y `onBlur`, mantiene `data-origin` y `inlineOrigins` para preservar la identidad del mapa de actores/etiquetas hasta guardar; `saveInlineDocument` asocia cada campo normalizado a su identidad anterior. El mapa sigue oculto al usuario. No se agregaron botones ni ventanas.
- **Advertencia:** no se ejecutaron compilación ni pruebas funcionales; comprobar borrar primero/intermedio, insertar campo, guardar y reabrir, y que actor/etiqueta no se desplacen. Revisar también efectos en procesos ya creados antes de editar la plantilla.
- **Regla de oro / continuidad:** consultar esta bitácora y commits antes de modificar; preservar lo que funciona y dejar decisiones y riesgos en cada intervención.
