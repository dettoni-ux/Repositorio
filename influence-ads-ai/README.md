# Influence Ads AI

Media buyer con IA para administrar **varias cuentas publicitarias de Meta y varios clientes** desde un solo panel.
Propiedad de Influence Chile SpA.

> Este directorio es independiente del resto del repositorio (sitio Milch, Estudio EncuentraVet y scripts RRSS),
> que no se modificaron.

## Qué hace

| Área | Funcionalidad |
|---|---|
| Multicliente | Clientes con ficha de negocio y marca, límites propios, memoria del asistente, selector global, vista agencia y vista por cliente. |
| Meta | OAuth oficial (sin contraseñas), descubrimiento de cuentas publicitarias, páginas y perfiles de Instagram **por separado**, asignación a clientes, sincronización de campañas/conjuntos/anuncios y métricas diarias, desconexión con revocación y borrado del token. |
| Métricas | Gasto, impresiones, alcance/frecuencia (por periodo, no sumados por día), CPM, CTR, CPC, leads, compras, ingresos, ROAS, costo por resultado; comparación con el periodo anterior; «Sin datos suficientes» cuando el volumen no alcanza. Calculadas en el backend. |
| Crear campaña con IA | Asistente que solo pregunta lo que falta → estrategia (producto, problema, público, objeciones, propuesta, prueba, CTA, destino, métrica) → conceptos distintos con hipótesis y copy completo → piezas → configuración → verificación → publicación **en pausa** → activación explícita. |
| Laboratorio creativo | Conceptos por ángulo (problema/solución, demostración, objeciones, testimonios reales, oferta, UGC…), edición/regeneración de textos, editor visual por formato (4:5, 1:1, 4:3, 9:16) con zonas seguras, fondos con fotos reales o generados con IA (sin texto), verificación técnica del archivo final y revisión ortográfica con IA. |
| Diagnóstico | Separa creatividad, audiencia, oferta, presupuesto, medición, sitio y proceso comercial. Cada hallazgo: qué ocurre, datos, causa probable y lo que no se puede confirmar, acción, resultado a evaluar, confianza y cuándo revisar. Usa pruebas estadísticas y volúmenes mínimos. |
| Aprendizaje | Experimentos por campaña publicada, evaluación de variantes con significancia, base de conocimiento por cliente (observado / hipótesis / conclusión) que alimenta a la IA **solo de ese cliente**. |
| Automatización | Nivel 1 observar (por defecto), 2 aprobar, 3 automático controlado con lista de acciones autorizadas, límites diario/mensual/variación, enfriamiento, retraso de atribución, datos frescos, tope diario, verificación del estado real en Meta antes de cambiar, botón de detención global y por cliente, historial auditable. |
| Ventas reales | Registro manual (p. ej. WhatsApp → venta) y webhooks firmados (HMAC) para CRM/tienda, con deduplicación; comparación Meta vs. negocio. |
| Seguridad | Sesiones con cookie httpOnly, contraseñas scrypt, roles (propietario, admin, media buyer, analista, solo lectura) y acceso por cliente, aislamiento por organización y cliente en todas las consultas, tokens cifrados AES-256-GCM, secretos ocultos en logs y auditoría, auditoría inmutable, límites de solicitudes, archivos privados validados por contenido. |

## Arquitectura

- **Next.js 16 (App Router) + TypeScript**, Server Components y Server Actions (sin API pública innecesaria).
- **PostgreSQL** (`pg`, SQL explícito en `migrations/`). Sin ORM.
- **Worker** en Node (`npm run worker`) con cola en PostgreSQL (`FOR UPDATE SKIP LOCKED`): sincronización cada 6 h, diagnóstico diario a la hora configurada, optimización nivel 3.
- **IA**: Claude (`@anthropic-ai/sdk`, modelo `claude-opus-5-5`, salidas estructuradas validadas con zod, respaldo ante rechazos del lado del servidor). Imágenes: Replicate (modelo configurable).
- **Archivos**: disco del servidor (`STORAGE_DIR`), servidos solo a usuarios con acceso al cliente.

```
src/
  app/            páginas (Inicio, Clientes, Cuentas, Campañas, Crear, Laboratorio, Resultados, Recomendaciones, Automatizaciones, Configuración) y rutas API
  app/actions/    acciones del servidor (cada una verifica sesión, rol y acceso al cliente)
  lib/            BD, sesión, aislamiento (tenancy), permisos, cifrado, métricas, estadística, reportes, almacenamiento
  meta/           cliente Graph API, OAuth, conexiones, sincronización, acciones, publicación
  ai/             Claude (estrategia, conceptos, copy, ficha de marca, revisión) e imágenes
  engine/         diagnóstico, decisiones y límites, borradores y validación, verificación de creatividades, aprendizaje
  worker/         proceso en segundo plano
migrations/       esquema SQL
tests/            92 pruebas (unitarias + integración con PostgreSQL)
```

## Puesta en marcha

```bash
cd influence-ads-ai
npm install
cp .env.example .env.local          # completar valores (ver abajo)
npm run db:migrate
npm run build && npm start          # app en http://localhost:3000
npm run worker                      # en otro proceso
```

**Vercel:** ver [`docs/VERCEL.md`](docs/VERCEL.md).

La primera visita abre `/configurar` para crear la agencia y el usuario propietario.

### Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | Sí | PostgreSQL |
| `ENCRYPTION_KEY` | Sí | 32 bytes base64 para cifrar tokens |
| `APP_URL` | Sí | URL pública (callback OAuth) |
| `META_APP_ID`, `META_APP_SECRET` | Para Meta | App de Meta tipo Empresa |
| `META_GRAPH_VERSION` | No | Por defecto `v26.0` |
| `META_LOGIN_CONFIG_ID` | No | Facebook Login for Business |
| `ANTHROPIC_API_KEY` | Para IA | Estrategia, conceptos y textos |
| `REPLICATE_API_TOKEN`, `REPLICATE_IMAGE_MODEL` | No | Fondos generados con IA |
| `STORAGE_DIR` | No | Directorio de archivos (fuera del repo en producción) |
| `STORAGE_DRIVER` | No | `fs` (disco) o `db` (PostgreSQL). En Vercel se usa `db` automáticamente |
| `CRON_SECRET` | En Vercel | Protege la tarea programada `/api/cron` |

Si falta una integración, la app lo indica en lenguaje simple y sigue funcionando en lo demás. **Nunca muestra datos de demostración como reales.**

## Pruebas

```bash
npm run typecheck
npm test        # requiere PostgreSQL; usa TEST_DATABASE_URL (por defecto influence_ads_test) y la recrea
```

Más detalle de integraciones y pendientes: [`docs/INTEGRACIONES.md`](docs/INTEGRACIONES.md).
