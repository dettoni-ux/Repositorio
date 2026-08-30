/**
 * Generación de video con IA (Seedance vía Replicate) para las piezas tipo «video».
 * Requiere REPLICATE_API_TOKEN; el modelo se cambia con SEEDANCE_MODEL.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const MODELO_DEF = 'bytedance/seedance-1-pro';

export function videoDisponible() {
  return Boolean(process.env.REPLICATE_API_TOKEN);
}

export async function generarVideo({ prompt, duracion = 10, salida }) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('Falta REPLICATE_API_TOKEN');
  const modelo = (process.env.SEEDANCE_MODEL || MODELO_DEF).trim();
  const cab = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let res = await fetch(`https://api.replicate.com/v1/models/${modelo}/predictions`, {
    method: 'POST',
    headers: { ...cab, Prefer: 'wait=60' },
    body: JSON.stringify({
      input: { prompt, duration: duracion, resolution: '1080p', aspect_ratio: '9:16' }
    })
  });
  let pred = await res.json();
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${JSON.stringify(pred).slice(0, 300)}`);

  const limite = Date.now() + 20 * 60_000;
  while (pred.status === 'starting' || pred.status === 'processing') {
    if (Date.now() > limite) throw new Error('Tiempo de espera agotado generando el video');
    await new Promise(r => setTimeout(r, 8000));
    res = await fetch(pred.urls.get, { headers: cab });
    pred = await res.json();
  }
  if (pred.status !== 'succeeded') {
    throw new Error(`Generación de video en estado ${pred.status}: ${JSON.stringify(pred.error || '').slice(0, 300)}`);
  }
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!url || typeof url !== 'string') throw new Error('La predicción no trajo URL de salida');

  mkdirSync(path.dirname(salida), { recursive: true });
  const bin = await fetch(url);
  writeFileSync(salida, Buffer.from(await bin.arrayBuffer()));
  return salida;
}
