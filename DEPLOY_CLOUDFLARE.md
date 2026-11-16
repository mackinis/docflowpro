# Despliegue en Producción — DocFlow Pro (100 % Cloudflare Nativo)

DocFlow Pro se ejecuta íntegramente sobre la infraestructura edge de **Cloudflare** sin servidores Node.js/Express, sin Firebase/Firestore, sin Google Gemini y sin servicios externos de correo o SMS.

---

## Arquitectura Implementada

| Servicio Cloudflare | Binding | Uso en DocFlow Pro |
| :--- | :--- | :--- |
| **Workers + Hono (TS)** | `worker/index.ts` | API completa `/api/*`, RBAC, sesiones `HttpOnly`, validación y reglas de negocio |
| **Workers Static Assets** | `ASSETS` (`./dist`) | Sirve el frontend React + Vite desde el mismo dominio que la API (`run_worker_first: ["/api/*"]`) |
| **Cloudflare D1** | `DB` (`docflow-pro-db`) | Base SQL normalizada (`migrations/0001_init.sql`): usuarios, sesiones, expedientes, plantillas, tareas, documentos, mensajes, auditoría |
| **Cloudflare R2** | `R2_BUCKET` (`docflow-pro-files`) | Almacenamiento binario real (`cases/*`, `shared/*`, `messages/*`) con descarga autorizada en streaming |
| **Cloudflare Workers AI** | `AI` | Auditoría inteligente, generación de plantillas y digitalización de documentos (PDF/DOCX/TXT) |
| **Cloudflare KV** | `KV` | Limitación de intentos de login (`login:<ip>:<email>`) y tokens temporales de recuperación de contraseña (TTL 15 min) |
| **Cloudflare Queues** | `DOCFLOW_QUEUE` (`docflow-pro-jobs`) | Fan-out asíncrono de notificaciones por cambio de rubro y limpieza de cuentas pendientes |
| **Cloudflare Turnstile** | `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Protección anti-bot en alta inicial, login, registro y recuperación de contraseña |

---

## 1. Requisitos Previos

```bash
npm install
npx wrangler login
```

---

## 2. Provisionar Recursos en Cloudflare

### 2.1 Base de Datos D1
```bash
npx wrangler d1 create docflow-pro-db
```
Copiar el `database_id` generado en `wrangler.jsonc` dentro de `d1_databases[0].database_id`.

Aplicar migraciones SQL:
```bash
# Local (desarrollo)
npm run db:migrate:local

# Producción remota
npm run db:migrate:remote
```

### 2.2 Bucket R2
```bash
npx wrangler r2 bucket create docflow-pro-files
```

### 2.3 Namespace KV
```bash
npx wrangler kv namespace create DOCFLOW_KV
```
Copiar el `id` devuelto en `wrangler.jsonc` dentro de `kv_namespaces[0].id`.

### 2.4 Cola (Cloudflare Queues)
```bash
npx wrangler queues create docflow-pro-jobs
```

### 2.5 Cloudflare Turnstile
1. En **Cloudflare Dashboard → Turnstile**, crear un widget para su dominio (ej. `docflow.tudominio.com`).
2. Colocar la **Site Key** en `wrangler.jsonc` (`vars.TURNSTILE_SITE_KEY`).
3. Guardar la **Secret Key** de forma cifrada como secreto del Worker:
```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

---

## 3. Despliegue Directo o vía GitHub (Cloudflare Workers)

### Opción A: CLI de Wrangler
```bash
npm run lint
npm run deploy
```

### Opción B: Integración Continua desde GitHub (Cloudflare Workers Builds)
1. En **Cloudflare Dashboard → Workers & Pages → Create → Import a repository**.
2. Seleccionar el repositorio y configurar:
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler d1 migrations apply docflow-pro-db --remote && npx wrangler deploy`
3. Verificar que el secreto `TURNSTILE_SECRET_KEY` esté configurado en **Settings → Variables and Secrets**.

---

## 4. Primer Acceso (Bootstrap del Primer Superadministrador)

La aplicación no contiene credenciales hardcodeadas. Al desplegar sobre una base D1 vacía:
1. Ingresar a la URL del Worker desplegado.
2. El sistema detectará automáticamente que no existen usuarios (`/api/auth/bootstrap-status`) y mostrará el asistente de creación del **Primer Superadministrador**.
3. Para el entorno local (`wrangler dev`), los errores de red hacia Turnstile se omiten automáticamente si `TURNSTILE_SECRET_KEY` está vacío; en producción se recomienda configurar siempre ambas claves de Turnstile.

---

## 5. Migración Única de Datos Legacy (Opcional)

Si posee una exportación JSON de Firestore/DocFlow anterior:
```bash
node scripts/migrate-firebase-to-cloudflare.mjs --input ./firestore-export.json
npx wrangler d1 execute docflow-pro-db --file=migrations/data-import.sql --remote
bash migration-output/upload-r2.sh
```
Los usuarios cuyo hash anterior no utilice `pbkdf2_sha256$` quedarán marcados como `REQUIRES_ADMIN_RESET` para restablecimiento seguro desde el panel de Superadmin.

---

## 6. Desarrollo Local

```bash
cp .env.example .env
cp .dev.vars.example .dev.vars
npm run dev
```
Levanta Vite + migración local D1 + `wrangler dev` en `http://localhost:3000` con persistencia en `.wrangler/state`.
