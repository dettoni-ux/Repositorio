/** Lista las voces de la cuenta de ElevenLabs, ordenadas por afinidad con el español chileno. */
import { listarVoces } from './voz.mjs';

if (!process.env.ELEVENLABS_API_KEY) { console.error('Falta el secret ELEVENLABS_API_KEY.'); process.exit(1); }
const voces = await listarVoces();
console.log(`Voces en la cuenta: ${voces.length}\n`);
console.log('JSON_VOCES_INICIO');
console.log(JSON.stringify(voces.map(v => ({ id: v.id, nombre: v.nombre, etiquetas: v.etiquetas, puntaje: v.puntaje })), null, 1));
console.log('JSON_VOCES_FIN');
console.log('\nRanking (mayor puntaje = más probable que suene chilena):');
voces.forEach((v, i) => console.log(` ${i + 1}. ${v.nombre} — ${v.id}${v.etiquetas ? ' — ' + v.etiquetas : ''} (puntaje ${v.puntaje})`));
