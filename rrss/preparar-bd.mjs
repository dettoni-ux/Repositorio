/**
 * Prepara la base de datos para el sistema de contenido, sin que nadie tenga que
 * escribir SQL a mano:
 *   1. Lista las tablas existentes (para saber con qué contamos).
 *   2. Crea la cola `rrss_piezas` si no existe.
 *   3. Detecta la tabla de veterinarios y le agrega el flag `autoriza_rrss`.
 *
 * Solo agrega cosas: no borra ni modifica nada de lo que ya existe.
 * Con REVISAR=1 solo informa lo que haría, sin tocar la base.
 */
import pg from 'pg';

const REVISAR = process.env.REVISAR === '1';
if (!process.env.DATABASE_URL) { console.error('Falta el secret DATABASE_URL.'); process.exit(1); }

const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cliente.connect();

try {
  const { rows: tablas } = await cliente.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`);
  console.log(`Tablas encontradas (${tablas.length}): ${tablas.map(t => t.table_name).join(', ') || '(ninguna)'}`);

  const existe = n => tablas.some(t => t.table_name === n);

  /* --- 1. Cola de piezas --- */
  if (existe('rrss_piezas')) {
    console.log('\n✓ La cola `rrss_piezas` ya existe.');
  } else if (REVISAR) {
    console.log('\n→ Se crearía la tabla `rrss_piezas`.');
  } else {
    await cliente.query(`
      CREATE TABLE rrss_piezas (
        id serial PRIMARY KEY,
        creado_en timestamptz NOT NULL DEFAULT now(),
        lote text,
        tipo text NOT NULL,
        formato text NOT NULL DEFAULT 'post',
        publico text,
        estado text NOT NULL DEFAULT 'pendiente'
          CHECK (estado IN ('pendiente','aprobada','rechazada','publicada','fallida')),
        fecha_programada timestamptz,
        caption text NOT NULL,
        visual jsonb NOT NULL,
        imagen_url text,
        nota_rechazo text,
        editado_en timestamptz,
        publicado_en timestamptz,
        ig_media_id text,
        error_publicacion text,
        intentos_publicacion int NOT NULL DEFAULT 0,
        metricas jsonb
      )`);
    await cliente.query(`CREATE INDEX rrss_piezas_estado_fecha ON rrss_piezas (estado, fecha_programada)`);
    console.log('\n✓ Cola `rrss_piezas` creada.');
  }

  /* --- 2. Flag de autorización en la tabla de veterinarios --- */
  const { rows: candidatas } = await cliente.query(
    `SELECT c.table_name, count(*) FILTER (WHERE c.column_name = 'autoriza_rrss') AS ya
       FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name <> 'rrss_piezas'
        AND (c.table_name IN ('practitioner','veterinarios','veterinario')
             OR c.table_name ILIKE '%profesional%'
             OR c.column_name IN ('verificado','colmevet','insignia_azul'))
      GROUP BY c.table_name ORDER BY c.table_name`);

  const forzada = (process.env.TABLA_VETS || '').trim();
  if (forzada) {
    if (!existe(forzada)) {
      console.log(`\n⚠ La tabla \`${forzada}\` no existe.`);
    } else {
      const { rows: [c] } = await cliente.query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND column_name='autoriza_rrss'`, [forzada]);
      const ident = '"' + forzada.replace(/"/g, '""') + '"';
      if (c.n > 0) console.log(`\n✓ \`${forzada}\` ya tiene el flag \`autoriza_rrss\`.`);
      else if (REVISAR) console.log(`\n→ Se agregaría el flag \`autoriza_rrss\` a \`${forzada}\`.`);
      else {
        await cliente.query(`ALTER TABLE ${ident} ADD COLUMN autoriza_rrss boolean NOT NULL DEFAULT false`);
        await cliente.query(`COMMENT ON COLUMN ${ident}.autoriza_rrss IS 'El profesional autoriza aparecer en las redes sociales de EncuentraVet'`);
        console.log(`\n✓ Flag \`autoriza_rrss\` agregado a \`${forzada}\` (todos en false).`);
      }
    }
  } else if (!candidatas.length) {
    console.log('\n⚠ No encontré una tabla de veterinarios. El flag `autoriza_rrss` queda pendiente:');
    console.log('  dime cuál de las tablas de arriba guarda los veterinarios y lo agrego.');
  } else if (candidatas.length > 1) {
    console.log(`\n⚠ Hay más de una tabla candidata: ${candidatas.map(c => c.table_name).join(', ')}.`);
    console.log('  Dime cuál es la de veterinarios y agrego el flag solo en esa.');
  } else {
    const tabla = candidatas[0].table_name;
    if (Number(candidatas[0].ya) > 0) {
      console.log(`\n✓ La tabla \`${tabla}\` ya tiene el flag \`autoriza_rrss\`.`);
    } else if (REVISAR) {
      console.log(`\n→ Se agregaría el flag \`autoriza_rrss\` a la tabla \`${tabla}\`.`);
    } else {
      const ident = '"' + tabla.replace(/"/g, '""') + '"';   // nombre de tabla citado con seguridad
      await cliente.query(`ALTER TABLE ${ident} ADD COLUMN autoriza_rrss boolean NOT NULL DEFAULT false`);
      await cliente.query(`COMMENT ON COLUMN ${ident}.autoriza_rrss IS 'El profesional autoriza aparecer en las redes sociales de EncuentraVet'`);
      console.log(`\n✓ Flag \`autoriza_rrss\` agregado a \`${tabla}\` (todos en false: nadie aparece hasta autorizar).`);
    }
  }

  /* --- 3. Columnas de las tablas que alimentan al generador --- */
  const aInspeccionar = (process.env.COLUMNAS || 'practitioner,commune,booking,review,location,provider')
    .split(',').map(t => t.trim()).filter(Boolean);
  for (const t of aInspeccionar) {
    if (!existe(t)) { console.log(`\n· \`${t}\`: no existe`); continue; }
    const { rows } = await cliente.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
    const { rows: [c] } = await cliente.query(`SELECT count(*)::int AS n FROM "${t.replace(/"/g,'""')}"`);
    console.log(`\n· \`${t}\` (${c.n} filas): ` + rows.map(r => r.column_name).join(', '));
  }

  if (existe('practitioner')) {
    try {
      const { rows } = await cliente.query(
        `SELECT "verificationStatus" AS estado, count(*)::int AS n FROM practitioner GROUP BY 1 ORDER BY 2 DESC`);
      console.log('\n· estados de verificación en `practitioner`: ' +
        rows.map(r => `${r.estado}=${r.n}`).join(', '));
    } catch (e) { console.log('\n· no pude leer verificationStatus: ' + e.message.split('\n')[0]); }
  }

  /* --- 4. Cifras reales para el generador --- */
  console.log('\nCifras que usará el generador:');
  for (const [nombre, sql] of [
    ['veterinarios verificados', 'SELECT count(*)::int AS n FROM veterinarios WHERE verificado = true'],
    ['comunas cubiertas', 'SELECT count(DISTINCT comuna)::int AS n FROM veterinarios WHERE verificado = true'],
    ['reservas del mes', "SELECT count(*)::int AS n FROM reservas WHERE creado_en >= date_trunc('month', now())"]
  ]) {
    try { const r = await cliente.query(sql); console.log(`  · ${nombre}: ${r.rows[0].n}`); }
    catch (e) { console.log(`  · ${nombre}: no disponible todavía (${e.message.split('\n')[0]})`); }
  }
} finally {
  await cliente.end();
}
console.log('\nListo.');
