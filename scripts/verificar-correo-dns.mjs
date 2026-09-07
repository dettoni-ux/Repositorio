#!/usr/bin/env node
// Verifica los registros DNS del correo corporativo de encuentravet.cl.
// Uso: node scripts/verificar-correo-dns.mjs [dominio]
// Sin dependencias: usa el resolvedor DNS de Node contra 8.8.8.8 / 1.1.1.1.

import { Resolver } from 'node:dns/promises';

const dominio = process.argv[2] || 'encuentravet.cl';
const resolver = new Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);

const ok = (t) => console.log(`  \x1b[32m✅\x1b[0m ${t}`);
const mal = (t) => console.log(`  \x1b[31m❌\x1b[0m ${t}`);
const ojo = (t) => console.log(`  \x1b[33m⚠️\x1b[0m  ${t}`);

async function intentar(fn) {
  try { return await fn(); } catch { return null; }
}

console.log(`\nRevisando el correo de \x1b[1m${dominio}\x1b[0m\n`);

// --- Nameservers: dónde se editan los registros ---
const ns = await intentar(() => resolver.resolveNs(dominio));
console.log('Nameservers (ahí se editan los registros)');
if (ns?.length) ns.sort().forEach((n) => ok(n));
else mal('sin respuesta');

// --- MX: recepción de correo ---
console.log('\nMX (recibir correo)');
const mx = await intentar(() => resolver.resolveMx(dominio));
if (!mx?.length) {
  mal('no hay registros MX: el dominio no puede recibir correo');
} else {
  const google = mx.some((m) => /(^|\.)(smtp\.google\.com|aspmx\.l\.google\.com)$/i.test(m.exchange));
  const zoho = mx.some((m) => /\.zoho\.(com|eu)$/i.test(m.exchange));
  mx.sort((a, b) => a.priority - b.priority)
    .forEach((m) => ok(`prioridad ${m.priority} → ${m.exchange}`));
  if (google && zoho) mal('hay MX de Google y de Zoho a la vez: deja solo un proveedor');
  else if (google) ok('apuntando a Google Workspace');
  else if (zoho) ok('apuntando a Zoho Mail');
  else ojo('los MX no son de Google ni de Zoho: revisa a qué proveedor apuntan');
}

// --- TXT del dominio raíz: SPF y verificaciones ---
const txt = (await intentar(() => resolver.resolveTxt(dominio)) || []).map((p) => p.join(''));

console.log('\nSPF (autoriza quién envía en tu nombre)');
const spf = txt.filter((t) => t.toLowerCase().startsWith('v=spf1'));
if (spf.length === 0) mal('no hay registro SPF');
else if (spf.length > 1) mal(`hay ${spf.length} registros SPF; debe existir SOLO uno (si no, SPF falla)`);
else {
  const r = spf[0];
  console.log(`     ${r}`);
  r.includes('_spf.google.com') ? ok('incluye Google Workspace') : mal('NO incluye _spf.google.com (el correo saliente de Google fallará SPF)');
  r.includes('amazonses.com') ? ok('incluye Amazon SES (correos del sitio)') : ojo('ya no incluye amazonses.com: confirma que el sitio no envía por SES');
  if (r.includes('-all')) ok('termina en -all (rechazo estricto)');
  else if (r.includes('~all')) ojo('termina en ~all (softfail): sirve para probar, endurece a -all al final');
  else mal('no termina en -all ni ~all');
}

const verif = txt.filter((t) => t.startsWith('google-site-verification='));
if (verif.length) {
  console.log('\nVerificación de dominio de Google');
  verif.forEach((v) => ok(v.slice(0, 45) + '…'));
}

// --- DKIM: firma criptográfica ---
console.log('\nDKIM (firma de tus correos)');
let dkimEncontrado = false;
for (const sel of ['google', 'zoho', 'zmail', 'default']) {
  const d = await intentar(() => resolver.resolveTxt(`${sel}._domainkey.${dominio}`));
  if (d?.length) {
    dkimEncontrado = true;
    const v = d.map((p) => p.join('')).join('');
    ok(`selector "${sel}" publicado (${v.length} caracteres)`);
    if (!v.includes('p=')) mal(`  el selector "${sel}" no trae clave pública (p=)`);
  }
}
if (!dkimEncontrado) mal('no se encontró DKIM en los selectores google / zoho / zmail / default');

// --- DMARC ---
console.log('\nDMARC (qué hacer con quien falsifique tu dominio)');
const dmarc = (await intentar(() => resolver.resolveTxt(`_dmarc.${dominio}`)) || [])
  .map((p) => p.join(''))
  .filter((t) => t.toLowerCase().startsWith('v=dmarc1'));
if (!dmarc.length) mal('no hay registro DMARC');
else if (dmarc.length > 1) mal(`hay ${dmarc.length} registros DMARC; debe existir solo uno`);
else {
  console.log(`     ${dmarc[0]}`);
  const pol = /[;\s]p=([a-z]+)/i.exec(dmarc[0])?.[1];
  if (pol === 'reject') ok('política p=reject (máxima protección)');
  else if (pol === 'quarantine') ok('política p=quarantine (buena; sube a reject cuando lleves semanas sin fallos)');
  else if (pol === 'none') ojo('política p=none (solo observa, no protege)');
  else mal('sin política p= válida');
  /rua=/.test(dmarc[0]) ? ok('tiene dirección de reportes (rua)') : ojo('sin rua: no recibirás reportes');
}

console.log('\nListo. Los cambios de DNS pueden tardar hasta 1-2 horas en propagarse.\n');
