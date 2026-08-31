#!/usr/bin/env node
/**
 * Genera un video con Seedance (u otro modelo de video) vía la API de Replicate.
 *
 * Variables de entorno:
 *   REPLICATE_API_TOKEN  (GitHub Secret) token de https://replicate.com/account/api-tokens
 *   MODELO               slug del modelo, por defecto bytedance/seedance-1-pro
 *   PROMPT               prompt del video (el que copia el Estudio de Contenido)
 *   PARAMETROS           JSON extra que se pasa al modelo, ej:
 *                        {"duration":10,"resolution":"1080p","aspect_ratio":"9:16"}
 *                        Revisa los nombres exactos en la página del modelo en Replicate.
 *   SALIDA               ruta del archivo de salida (por defecto videos/video-<timestamp>.mp4)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) { console.error('Falta el secret REPLICATE_API_TOKEN.'); process.exit(1); }
const MODELO = (process.env.MODELO || 'bytedance/seedance-1-pro').trim();
const PROMPT = (process.env.PROMPT || '').trim();
if (!PROMPT) { console.error('Falta PROMPT.'); process.exit(1); }

let extra = {};
try { extra = JSON.parse(process.env.PARAMETROS || '{}'); }
catch { console.error('PARAMETROS no es JSON válido.'); process.exit(1); }

const cab = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

console.log(`Modelo: ${MODELO}`);
console.log(`Prompt: ${PROMPT.slice(0, 200)}${PROMPT.length > 200 ? '…' : ''}`);

let res = await fetch(`https://api.replicate.com/v1/models/${MODELO}/predictions`, {
  method: 'POST',
  headers: { ...cab, Prefer: 'wait=60' },
  body: JSON.stringify({ input: { prompt: PROMPT, ...extra } })
});
let pred = await res.json();
if (!res.ok) {
  console.error('Error de Replicate:');
  console.error(JSON.stringify(pred, null, 2));
  if (res.status === 404) console.error(`¿Existe el modelo «${MODELO}»? Revisa el slug en replicate.com.`);
  process.exit(1);
}

const limite = Date.now() + 20 * 60_000;
while (pred.status === 'starting' || pred.status === 'processing') {
  if (Date.now() > limite) { console.error('Tiempo de espera agotado.'); process.exit(1); }
  await new Promise(r => setTimeout(r, 8000));
  res = await fetch(pred.urls.get, { headers: cab });
  pred = await res.json();
  console.log(`  estado: ${pred.status}`);
}

if (pred.status !== 'succeeded') {
  console.error(`La generación terminó en estado ${pred.status}:`);
  console.error(JSON.stringify(pred.error || pred, null, 2));
  process.exit(1);
}

const salidaUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
if (!salidaUrl || typeof salidaUrl !== 'string') {
  console.error('No se encontró URL de salida en la predicción:');
  console.error(JSON.stringify(pred.output, null, 2));
  process.exit(1);
}
console.log('Video generado: ' + salidaUrl);

const destino = process.env.SALIDA || `videos/video-${Date.now()}.mp4`;
mkdirSync(dirname(destino), { recursive: true });
const bin = await fetch(salidaUrl);
writeFileSync(destino, Buffer.from(await bin.arrayBuffer()));
console.log('Guardado en: ' + destino);
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `archivo=${destino}\n`, { flag: 'a' });
}
