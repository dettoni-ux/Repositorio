/**
 * Qué se gastó realmente en Replicate: lista las últimas predicciones con lo
 * que se les envió, cuánto demoraron y cuántos segundos de video devolvieron.
 *
 *   node costo.mjs [cuántas]
 *
 * Requiere REPLICATE_API_TOKEN. El cobro exacto lo manda Replicate en
 * replicate.com/account/billing; aquí se estima con la tarifa por segundo
 * de salida del modelo (variable REPLICATE_USD_POR_SEG).
 */
const token = process.env.REPLICATE_API_TOKEN;
if (!token) {
  console.error('Falta REPLICATE_API_TOKEN.');
  process.exit(1);
}
const cab = { Authorization: `Bearer ${token}` };
const cuantas = Math.min(50, Math.max(1, parseInt(process.argv[2] || '10', 10) || 10));
const tarifa = Number(process.env.REPLICATE_USD_POR_SEG || 0);

const res = await fetch('https://api.replicate.com/v1/predictions', { headers: cab });
if (!res.ok) {
  console.error(`Replicate ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const { results = [] } = await res.json();

let segundosTotales = 0, procesoTotal = 0, fallidas = 0;
console.log(`Últimas ${Math.min(cuantas, results.length)} predicciones:\n`);

for (const p of results.slice(0, cuantas)) {
  const dur = p.input?.duration ?? p.input?.duration_seconds ?? null;
  const proceso = p.metrics?.predict_time ?? null;
  if (p.status === 'succeeded' && dur) segundosTotales += Number(dur);
  if (proceso) procesoTotal += proceso;
  if (p.status === 'failed' || p.status === 'canceled') fallidas++;

  const partes = [
    p.model || '(modelo desconocido)',
    p.status,
    dur ? `${dur} s de video` : null,
    p.input?.resolution ? `resolución pedida: ${p.input.resolution}` : null,
    p.input?.image ? 'con cuadro inicial encadenado' : null,
    proceso ? `procesó en ${proceso.toFixed(1)} s` : null
  ].filter(Boolean);
  console.log(`  ${p.created_at?.slice(0, 19).replace('T', ' ')} · ${partes.join(' · ')}`);
  if (p.error) console.log(`      error: ${String(p.error).slice(0, 160)}`);
}

console.log(`\nSegundos de video generados con éxito: ${segundosTotales}`);
console.log(`Tiempo de cómputo sumado: ${procesoTotal.toFixed(1)} s`);
if (fallidas) console.log(`Predicciones fallidas o canceladas: ${fallidas} (esas no se cobran)`);
if (tarifa > 0) {
  console.log(`Estimado a USD ${tarifa}/segundo de salida: USD ${(segundosTotales * tarifa).toFixed(2)}`);
} else {
  console.log('Para estimar el cobro, pon la tarifa por segundo del modelo en REPLICATE_USD_POR_SEG.');
}
console.log('El cobro exacto está en https://replicate.com/account/billing');
