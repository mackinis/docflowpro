# Auditoría transversal RBAC — 2026-11-21

## Alcance y método
Inspección estática de **16 módulos de rutas HTTP** del Worker, del middleware global
`worker/access-ai-settings.ts`, del resolvedor de sesión `worker/index.ts` y de
`src/rbac.ts`. No se ejecutaron pruebas con usuarios reales ni una base D1 de producción.
**No es una certificación de ausencia de vulnerabilidades.**

## Inventario de familias y autorización

| Familia HTTP | Archivo | Autorización RBAC global | Control adicional | Riesgo/acción |
|---|---|---|---|---|
| `/api/users` | user-admin-routes | users | Validaciones de campos sensibles, jerarquía | Comprobar métodos y overrides por campo |
| `/api/admin/user-creators`, `registration-policy` | user-admin-routes | users | Roles específicos | Comprobar política de administración |
| `/api/statistics` | case-routes | statistics | statistics.view para lectura | Validar acceso de cada asesor |
| `/api/cases`, `tasks`, `observations`, `forms` | case-routes, case-workflow-routes, stage-transition-routes | cases | Responsabilidad de legajo/etapa | Pruebas de acceso cruzado |
| `/api/case-drafts` | case-routes | **cases (corregido)** | Control por legajo | Antes no coincidía con ninguna regla global |
| `/api/documents`, `shared-documents`, `upload-requests` | document-routes, shared-document-routes | documents | Carga de requisitos exceptuada del RBAC global; control local | Verificar todas las variantes de carga |
| `/api/confecciones` | confecciones-routes | **templates (corregido, provisional)** | Restricción explícita de roles y legajo | Requiere módulo RBAC propio si se delega separadamente |
| `/api/system-messages` | system-message-routes | messages | Acceso por destinatario | Pruebas de mensajes ajenos |
| `/api/notifications` | notification-routes | notifications | Acceso por usuario | Pruebas de notificaciones ajenas |
| `/api/templates` | template-routes | templates | Roles y alcance | Pruebas de edición de terceros |
| `/api/ai`, `/api/gemini` | ai-document-routes, access-ai-settings | ai | Listas aiAllowedRoles/aiSettingsRoles | Dos capas independientes: deben coincidir |
| `/api/system-settings`, `industry`, `verification-policy`, `admin/backup`, `admin/cleanup-unverified` | config-admin-routes | settings | Restricciones SUPERADMIN/ADMIN | Backup POST se clasifica edit, no download |
| `/api/audit-logs` | case-workflow-routes | audit | Ingestión de auditoría exceptuada | Exportación debe tener permiso explícito |
| `/api/audit/navigation` | core-routes | excepción justificada | Solo ingesta | No debe revelar historial |
| `/api/state` | core-routes | **sin clasificación global** | getFullState aplica filtrado | Requiere verificación de campos y roles |
| `/api/auth` | auth-routes | fuera del RBAC modular | Autenticación y controles propios | Revisar impersonación y perfil |
| `/api/admin/rbac` | access-ai-settings | superadmin exclusivamente | Denegación global y en handler | Mantener |
| `/api/permissions/me` | access-ai-settings | sesión autenticada | Devuelve solo permisos efectivos | Mantener |
| `/api/health` | core-routes | público | No debe filtrar secretos | Mantener |

## Hallazgos de riesgo

**ALTO — Predeterminado permisivo.** En `hasRbacPermission`, si no hay override
ni baseline definido, se devuelve `true`. La matriz no es deny-by-default
para ADMIN/MANAGER. Migrar sin un plan de permisos existentes puede bloquear
usuarios, pero dejarlo igual mantiene permisos implícitos amplios.

**ALTO — Rutas sin política completa.** `/api/state` es una agregación de datos
no clasificada por módulo; requiere pruebas de filtrado real. Se corrigieron
`/api/case-drafts` y `/api/confecciones` en esta rama.

**MEDIO — Acción por verbo HTTP.** El middleware convierte POST en `edit`
salvo excepciones y GET en `view`; esto no equivale a operaciones semánticas.
Por ejemplo `POST /api/admin/backup` es una exportación, y
`POST /api/ai/analyze-document` ejecuta una función, no edita configuración.
No cambiar estas rutas sin definir contratos y compatibilidad de permisos.

**MEDIO — IA tiene doble autorización.** `ai.view`/`ai.edit` y las listas
`aiAllowedRoles`/`aiSettingsRoles` son mecanismos distintos. Hay que
probar cada combinación y documentar qué deniega cada uno.

**MEDIO — Confecciones sin permiso propio.** Actualmente su entrada de menú
depende de `templates.view`; se aplicó esa misma política a las rutas,
además de la restricción de roles existente. Un módulo separado permitiría
administrar ambos dominios de forma independiente.

**MEDIO — Matriz de acciones imperfecta.** `statistics.manage` está habilitado
en el catálogo, pero no se identificó un endpoint administrativo propio que
lo consuma. `audit.download` y `cases.download` deben verificarse contra
rutas reales antes de prometer funcionalidad.

## Criterios para cerrar la auditoría funcional

1. Tests de autorización permitida/denegada por ruta y verbo para ADMIN,
   MANAGER, ASESOR, SUPERADMIN, con overrides individuales positivos/negativos.
2. Tests de aislamiento entre usuarios, legajos, documentos, mensajes,
   notificaciones, confecciones y estadísticas.
3. Política explícita para cada endpoint; dejar de inferir permisos por verbo.
4. Política de migración de baselines a denegación por defecto, sin romper
   las funciones legítimas.
5. Pruebas con D1 y despliegue Cloudflare confirmado.

**Conclusión:** la inspección estática del código de rutas está realizada;
la verificación funcional exhaustiva y la migración segura a deny-by-default
**siguen pendientes**. No confundir el estado de GitHub Actions con una
certificación de seguridad del entorno productivo.
