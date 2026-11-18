# REGLA DE ORO — CONTINUIDAD ENTRE CHATS (DocFlow Pro)

> BREADCRUMB PERMANENTE: Antes de tocar código, leer `docs/CONTEXTO_IA.md`, este archivo, los commits relevantes y el código vigente. Al terminar cada intervención, actualizar la bitácora y dejar una referencia a ella en el mensaje de commit. No dar por verificado lo que no se probó.

## Objetivo
Este repositorio es también la bitácora operativa de continuidad de ChatGPT entre conversaciones. Escribir para la **próxima instancia del asistente**, no solo para desarrolladores. Registrar la intención real del usuario, las correcciones que hizo, los intentos fallidos, las decisiones y los pendientes.

## Protocolo obligatorio por intervención técnica
1. **ANTES:** leer este archivo y `docs/CONTEXTO_IA.md`; revisar historial de commits pertinente y estado real del código. Si hay contradicción, priorizar el código comprobado y señalarla. No confiar ciegamente en resúmenes.
2. **DURANTE:** cambiar solo lo solicitado; preservar funciones existentes; no improvisar interfaces o flujos adicionales. Documentar decisiones y errores, especialmente los que el usuario corrigió.
3. **DESPUÉS:** registrar en `docs/CONTEXTO_IA.md` fecha, objetivo, intención del usuario, archivos, cambios, resultado, pruebas realmente ejecutadas, riesgos, errores, pendientes y siguiente paso. Nunca declarar resuelto algo sin validación.
4. **BREADCRUMB EN CADA COMMIT DE TRABAJO:** incluir al final del mensaje de commit la línea `Continuidad-IA: docs/CONTEXTO_IA.md`. Si una operación o herramienta no permite el mensaje extendido, registrar el commit y su propósito en la bitácora inmediatamente después.
5. **AL CAMBIAR DE CHAT:** leer primero los archivos de continuidad y después los commits posteriores a la última entrada; no asumir que el último commit está desplegado ni que pasó pruebas.

## Reglas de producto confirmadas por el usuario
- La **digitalización** debe identificar y guardar una sola vez el mapa semántico de campos. Procesos, Legajos y Confecciones deben reutilizarlo sin reinterpretarlo independientemente.
- Cada campo requiere identidad inequívoca (actor, significado, marcador y versión de plantilla). No confundir cónyuges, locador, locatario, garantes ni condiciones de la operación.
- Preservar formato y funcionalidades que ya funcionan; no añadir botones, modales o pasos no solicitados.
- En la vista de plantilla digitalizada, el usuario quiere **edición directa del documento**, sin un botón que abra un editor alternativo. Conservar campos amarillos y numeración consistente.
- Diferenciar explícitamente: solicitado / implementado / probado / desplegado / confirmado por usuario.
- Registrar correcciones del usuario y evitar repetir soluciones rechazadas.

## Alcance y límites
Este protocolo es una regla del repositorio, no una garantía de memoria infalible. Una instancia nueva debe poder acceder al repositorio para leerlo. La bitácora no reemplaza pruebas ni inspección del código. No guardar secretos, credenciales, datos personales innecesarios ni documentos privados en esta memoria.

**Pista de recuperación:** `AGENTS.md` → `docs/CONTEXTO_IA.md` → `git log` → archivos actuales → pruebas.
