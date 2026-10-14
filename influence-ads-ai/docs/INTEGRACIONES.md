# Integraciones, verificación y pendientes

## Estado por fase

| Fase | Estado | Verificación |
|---|---|---|
| 1. Arquitectura y BD | Listo | Migración aplicada; FK compuestas impiden asignar recursos a clientes de otra organización. |
| 2. Interfaz, autenticación, clientes | Listo | Prueba E2E en navegador: alta guiada, ficha, materiales, selector global, 12 páginas sin errores. |
| 3. Generador y laboratorio creativo | Listo (IA requiere clave) | E2E: concepto → pieza 4:5 → exportación 1080×1350 verificada → aprobación. Generación de textos/imágenes **no ejecutada** aquí por falta de `ANTHROPIC_API_KEY`/`REPLICATE_API_TOKEN`. |
| 4. OAuth y lectura multicuenta | Implementado | Pruebas de integración con respuestas con forma de la Marketing API. **No probado contra Meta real**: este entorno no tiene salida a graph.facebook.com ni credenciales. |
| 5. Métricas y diagnóstico | Listo | Pruebas unitarias e integración (sincronización → rendimiento → diagnóstico). |
| 6. Experimentos y aprendizaje | Listo | Evaluación de variantes con significancia; base de conocimiento por cliente. |
| 7. Borradores | Listo | Validación previa (cuenta, presupuesto, objetivo, audiencia, destino, piezas, copy, permisos, políticas). |
| 8. Publicación y optimización | Implementado | Publicación en pausa, reanudable y activación explícita probadas contra la API simulada; ejecución de acciones con lectura previa/posterior. Pendiente prueba con una cuenta real. |
| 9. Seguridad y aislamiento | Listo | Pruebas de aislamiento entre agencias y clientes, roles, cifrado, auditoría inmutable, archivos alterados, firmas HMAC. |

## Meta Marketing API

1. Crear app **Empresa** en developers.facebook.com; agregar *Facebook Login for Business* y *Marketing API*.
2. URI de redirección: `{APP_URL}/api/meta/oauth/callback`.
3. Permisos: `ads_read`, `ads_management`, `business_management`, `pages_show_list`, `pages_read_engagement`, `instagram_basic`.
   Para cuentas de terceros se necesita **acceso avanzado** (Revisión de la app + verificación del negocio).
4. Token: se canjea el código por un token de larga duración (~60 días), se inspecciona con `debug_token` y se guarda cifrado.
   La app avisa cuando vence pronto y marca la conexión como vencida si Meta responde error 190.
5. Cada llamada envía `appsecret_proof` y respeta los encabezados `x-business-use-case-usage` / `x-ad-account-usage`.

### Primera prueba real recomendada (checklist)

1. Conectar con un usuario administrador de una cuenta publicitaria de prueba.
2. Asignar la cuenta a un cliente, marcar «Administrar» y «Sincronizar ahora». Comparar gasto e impresiones de 7 días con el Administrador de anuncios.
3. Publicar un borrador con presupuesto mínimo: confirmar en el Administrador que campaña, conjuntos y anuncios quedan **en pausa**.
4. Verificar en particular (no validado contra la API real): `destination_type` y `promoted_object` por objetivo,
   el CTA de WhatsApp (`WHATSAPP_MESSAGE` con `app_destination`), y que la tabla de monedas sin decimales coincida con la cuenta.

### Limitaciones conocidas

- Métricas de periodos personalizados: alcance/frecuencia solo para las ventanas sincronizadas (7/30 días y anteriores).
- Consultas de insights síncronas con tramos de 7 días; para cuentas muy grandes conviene usar reportes asíncronos (`report_run_id`).
- Formularios instantáneos: se usa un formulario existente (ID); no se crean formularios desde la app.
- Video: se generan guion y texto en pantalla; la generación de video (Seedance vía Replicate, ya usada en `/rrss`) no está conectada al laboratorio.
- Límite de solicitudes en memoria: con varias instancias usar un almacén compartido.
- Atribución: Meta y el registro real no se suman entre sí; las diferencias se diagnostican, no se "corrigen".

## Webhook de ventas y leads

`POST /api/webhooks/conversions/{id}` con encabezado `X-Signature: hex(HMAC-SHA256(cuerpo, clave))`:

```json
{ "events": [ { "external_id": "pedido-123", "kind": "sale", "occurred_at": "2026-10-01T15:00:00-03:00",
                "value": 49990, "margin": 20000, "currency": "CLP", "campaign_id": "1202..." } ] }
```

`kind`: `conversation` · `lead` · `qualified_lead` · `sale`. Los eventos repetidos (mismo `external_id` y tipo) se ignoran.
