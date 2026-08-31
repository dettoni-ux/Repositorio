/**
 * Imprime el esquema real de entrada del modelo de video, para dejar de
 * adivinar nombres y formatos de parámetros.
 *
 *   node esquema.mjs [modelo]
 *
 * Requiere REPLICATE_API_TOKEN. No genera nada: solo consulta, no cuesta.
 */
const token = process.env.REPLICATE_API_TOKEN;
if (!token) {
  console.error('Falta REPLICATE_API_TOKEN.');
  process.exit(1);
}
const modelo = (process.argv[2] || process.env.SEEDANCE_MODEL || 'bytedance/seedance-1-lite').trim();

const res = await fetch(`https://api.replicate.com/v1/models/${modelo}`, {
  headers: { Authorization: `Bearer ${token}` }
});
if (!res.ok) {
  console.error(`Replicate ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const info = await res.json();
const props = info?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties || {};

console.log(`Modelo: ${modelo}`);
console.log(`Versión: ${info?.latest_version?.id}`);
if (info.description) console.log(`Descripción: ${info.description}`);
console.log(`\nParámetros de entrada (${Object.keys(props).length}):\n`);

for (const [nombre, d] of Object.entries(props)) {
  const partes = [d.type || (d.allOf ? 'referencia' : '?')];
  if (d.format) partes.push(`formato ${d.format}`);
  if (d.items) partes.push(`lista de ${d.items.type || d.items.format || '?'}${d.items.format ? ` (${d.items.format})` : ''}`);
  if (d.enum) partes.push(`opciones: ${JSON.stringify(d.enum)}`);
  if (d.minimum !== undefined || d.maximum !== undefined) partes.push(`rango ${d.minimum ?? '-'}..${d.maximum ?? '-'}`);
  if (d.default !== undefined) partes.push(`por defecto ${JSON.stringify(d.default)}`);
  if (d.maxItems !== undefined) partes.push(`máx ${d.maxItems} elementos`);
  console.log(`  ${nombre} — ${partes.join(' · ')}`);
  if (d.description) console.log(`      ${d.description}`);
}

// Los enums referenciados viven aparte; interesan los de duración y resolución.
const esquemas = info?.latest_version?.openapi_schema?.components?.schemas || {};
for (const [nombre, def] of Object.entries(esquemas)) {
  if (nombre !== 'Input' && nombre !== 'Output' && def.enum) {
    console.log(`\n  (${nombre}) opciones: ${JSON.stringify(def.enum)}`);
  }
}
