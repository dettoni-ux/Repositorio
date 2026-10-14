# Publicar Influence Ads AI en Vercel

En Vercel la app guarda los archivos en la base de datos y reemplaza el worker por una
tarea programada diaria (`vercel.json` → `/api/cron`). Las migraciones de base de datos se
aplican solas en cada despliegue (`npm run vercel-build`).

## 1. Crear el proyecto
1. vercel.com → **Add New… → Project** → importar `dettoni-ux/Repositorio`.
2. **Root Directory:** `influence-ads-ai` (Framework: Next.js, lo detecta solo).
3. Pulsar **Deploy**. Este primer despliegue **fallará** porque aún no hay base de datos: es normal.

## 2. Base de datos
Proyecto → **Storage → Create Database → Neon (Postgres)** → conectarla al proyecto.
Vercel crea `DATABASE_URL` automáticamente. Usa una base **nueva**, no la de EncuentraVet.

## 3. Variables (Settings → Environment Variables, entorno Production, marcar «Sensitive»)
| Nombre | Valor |
|---|---|
| `ENCRYPTION_KEY` | Resultado de `openssl rand -base64 32` en la Terminal. **Guárdala también en tu gestor de contraseñas: si cambia, los tokens de Meta guardados dejan de poder leerse.** |
| `CRON_SECRET` | Otro valor de `openssl rand -base64 32` |
| `APP_URL` | `https://<tu-proyecto>.vercel.app` (o tu dominio propio) |
| `ANTHROPIC_API_KEY` | Clave de console.anthropic.com |
| `META_APP_ID`, `META_APP_SECRET` | De developers.facebook.com (paso 6) |
| `REPLICATE_API_TOKEN` | Opcional (fondos con IA) |

## 4. Volver a desplegar
**Deployments → ⋯ → Redeploy.** En el registro debe aparecer `✓ 001_base.sql` y `✓ 002_blobs.sql`.

## 5. Primer ingreso
Abre la URL: aparece `/configurar` para crear la agencia y tu usuario propietario (solo la primera vez).

## 6. App de Meta
En developers.facebook.com → tu app → Inicio de sesión con Facebook para empresas → Configuración:
- **URI de redirección de OAuth válidos:** `https://<tu-dominio>/api/meta/oauth/callback`
- Configuración básica → **Dominios de la app:** `<tu-dominio>`

Luego en la app: **Cuentas publicitarias → Conectar con Meta**.

## Límites de Vercel a tener en cuenta
- **Plan:** el plan Hobby es para uso personal/no comercial; para Influence Chile corresponde **Pro**.
- **Tarea programada:** en Hobby solo 1 vez al día (configurada a las 13:00 UTC ≈ 9–10 h Chile). En Pro puedes cambiar `vercel.json` a `"0 * * * *"` (cada hora). Además, «Sincronizar ahora» y «Diagnosticar ahora» siempre funcionan a mano.
- **Archivos:** máximo ~4,5 MB por envío; sube fotos pesadas de a una. Videos grandes no caben: queda pendiente conectar un almacenamiento de archivos externo.
- **Tiempo:** las páginas que usan IA tienen hasta 300 s por solicitud.
