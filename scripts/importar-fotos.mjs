// Importa una carpeta de fotos como fotos principales de sus artículos (sistema de fotos: src/lib/archivos.ts).
//
// Cada foto se llama como el artículo al que va: por su id (localidad-burgos.jpg) o, para los colegiales,
// por el id del colegial (2014asno.jpg). Por cada una:
//   - se procesa igual que una subida desde el editor (sin EXIF/GPS, girada, original + 1600/800/320 en WebP)
//     y se guarda ya publicada en ARCHIVOS_DIR/<tipo>/<artículo>/<nombre>-<huella>/;
//   - se crea una versión nueva del artículo (mismo texto) con esa foto como principal, firmada como
//     «Santacruzpedia (automático)», así que queda en el historial y se puede deshacer.
// Si la carpeta tiene creditos.json ({ "<nombre sin extensión>": "autor" } o { …: { autor, licencia, fuente } }),
// se guardan como crédito de cada foto.
//
// Es repetible: salta los artículos que ya tienen foto principal (salvo con --reemplazar) y reutiliza las fotos
// ya importadas (misma huella).
//
//   node --env-file=.env scripts/importar-fotos.mjs <carpeta> [opciones]
//     --autor "Texto"   autor de las fotos que no tengan crédito propio
//     --reemplazar      también en los artículos que ya tienen foto principal
//     --solo a,b,c      solo esas fotos (nombres sin extensión)
//     --prueba          lo hace todo y lo deshace al final (no deja fotos ni versiones)
//
// En el servidor (Docker), por ejemplo con las fotos de perfil:
//   sudo docker compose run --rm -v /var/www/html/assets/cmusantacruz/profile_photos:/importar:ro \
//     santacruzpedia node scripts/importar-fotos.mjs /importar --autor "Colegio Mayor Santa Cruz"
import pg from 'pg';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, isAbsolute, extname, basename } from 'node:path';

// ---------- opciones ----------
const args = process.argv.slice(2);
const opcion = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const carpeta = args.find((a, i) => !a.startsWith('--') && !['--autor', '--solo'].includes(args[i - 1]));
const PRUEBA = args.includes('--prueba');
const REEMPLAZAR = args.includes('--reemplazar');
const AUTOR_POR_DEFECTO = opcion('--autor');
const SOLO = opcion('--solo')?.split(',').map(s => s.trim()).filter(Boolean) ?? null;
if (!carpeta || !existsSync(carpeta)) {
  console.error('Uso: node scripts/importar-fotos.mjs <carpeta> [--autor "Texto"] [--reemplazar] [--solo a,b] [--prueba]');
  process.exit(1);
}
for (const v of ['PGUSER', 'PGPASSWORD']) if (!process.env[v]) { console.error(`Falta la variable ${v} (usa --env-file=.env)`); process.exit(1); }

const DIR_ARCHIVOS = (() => { const d = process.env.ARCHIVOS_DIR || 'datos/archivos'; return isAbsolute(d) ? d : join(process.cwd(), d); })();
const DIR_DESTINO = PRUEBA ? join(DIR_ARCHIVOS, '_prueba-importacion') : DIR_ARCHIVOS;
const AUTOR_VERSION = 'Santacruzpedia (automático)';
const SUBIDO_POR = 'Importación de fotos';
const TAMANOS = [1600, 800, 320];
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const CARPETA_TIPO = {
  colegial: 'colegiales', curso: 'cursos', habitacion: 'habitaciones', evento: 'eventos', tipo_evento: 'tipos-de-evento',
  estudio: 'estudios', director: 'directores', localidad: 'localidades', libro: 'libros', autor: 'autores', libre: 'otros',
};
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'foto';

// créditos de la carpeta
const creditos = existsSync(join(carpeta, 'creditos.json')) ? JSON.parse(readFileSync(join(carpeta, 'creditos.json'), 'utf8')) : {};
const creditoDe = clave => {
  const c = creditos[clave];
  if (typeof c === 'string') return { autor: c, licencia: null, fuente: null };
  if (c) return { autor: c.autor || null, licencia: c.licencia || null, fuente: c.fuente || c.url || null };
  return { autor: AUTOR_POR_DEFECTO, licencia: null, fuente: null };
};

// ---------- base de datos ----------
const db = new pg.Client({
  host: process.env.PGHOST || '100.107.17.5', port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'scdb', user: process.env.PGUSER, password: process.env.PGPASSWORD,
});
await db.connect();
const q = async (sql, p) => (await db.query(sql, p)).rows;

// artículos publicados, por id y por colegial
const articulos = await q(
  `select a.id, a.titulo, a.tipo, a.colegial_id, a.revision_actual, r.contenido, r.imagen_id, c.nombre as colegial_nombre, c.mote
   from wiki.articulo a join wiki.revision r on r.id = a.revision_actual left join colegial c on c.id = a.colegial_id`);
const porId = new Map(articulos.map(a => [a.id, a]));
const porColegial = new Map(articulos.filter(a => a.colegial_id).map(a => [a.colegial_id, a]));

// ---------- procesado (igual que src/lib/archivos.ts) ----------
async function guardarVersiones(datos, formato, destino) {
  await mkdir(destino, { recursive: true });
  const base = () => sharp(datos, { limitInputPixels: 80_000_000 }).rotate();
  const original = formato === 'jpg' ? base().jpeg({ quality: 92, mozjpeg: true })
    : formato === 'png' ? base().png({ compressionLevel: 9 }) : base().webp({ quality: 92 });
  await writeFile(join(destino, `original.${formato}`), await original.toBuffer());
  for (const t of TAMANOS) {
    await writeFile(join(destino, `${t}.webp`),
      await base().resize({ width: t, height: t, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer());
  }
}

/** nombre libre en la wiki: «Burgos.jpg», o «Burgos (2).jpg» si ya existe */
async function nombreLibre(base, ext) {
  for (let n = 1; ; n++) {
    const nombre = `${base.replace(/[[\]{}|#<>/\\:]/g, '')}${n > 1 ? ` (${n})` : ''}.${ext}`;
    if (!(await q('select 1 from wiki.archivo where lower(nombre) = lower($1)', [nombre])).length) return nombre;
  }
}

// ---------- importación ----------
const ficheros = readdirSync(carpeta).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort()
  .filter(f => !SOLO || SOLO.includes(basename(f, extname(f))));
const resumen = { importadas: 0, reutilizadas: 0, conFoto: [], sinArticulo: [], errores: [] };
const creadas = [];   // carpetas creadas (para limpiar en --prueba o si falla)

await db.query('begin');
try {
  for (const f of ficheros) {
    const clave = basename(f, extname(f));
    const art = porId.get(clave) ?? porColegial.get(clave);
    if (!art) { resumen.sinArticulo.push(f); continue; }
    if (art.imagen_id != null && !REEMPLAZAR) { resumen.conFoto.push(`${f} (${art.titulo})`); continue; }

    const datos = readFileSync(join(carpeta, f));
    let meta;
    try { meta = await sharp(datos, { limitInputPixels: 80_000_000 }).metadata(); } catch { resumen.errores.push(`${f}: no es una imagen válida`); continue; }
    const formato = EXT[meta.format];
    if (!formato) { resumen.errores.push(`${f}: formato ${meta.format} no admitido`); continue; }

    const huella = createHash('sha256').update(datos).digest('hex').slice(0, 16);
    let [archivo] = await q('select id, nombre, estado from wiki.archivo where huella = $1', [huella]);
    if (archivo) {
      if (archivo.estado !== 'publicado') await q(`update wiki.archivo set estado = 'publicado' where id = $1`, [archivo.id]);
      resumen.reutilizadas++;
    } else {
      const nombre = await nombreLibre(art.titulo, formato);
      const rel = `${CARPETA_TIPO[art.tipo] ?? 'otros'}/${art.id}/${slug(art.titulo)}-${huella.slice(0, 8)}`;
      const destino = join(DIR_DESTINO, rel);
      await rm(destino, { recursive: true, force: true });
      await guardarVersiones(datos, formato, destino);
      creadas.push(destino);
      const girada = (meta.orientation ?? 1) >= 5;
      const cred = creditoDe(clave);
      [archivo] = await q(
        `insert into wiki.archivo (nombre, huella, carpeta, formato, ancho, alto, bytes, descripcion, autor, licencia, fuente,
                                   estado, articulo_id, usuario_id, subido_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'publicado', $12, null, $13) returning id, nombre`,
        [nombre, huella, rel, formato, girada ? meta.height : meta.width, girada ? meta.width : meta.height, datos.length,
         art.colegial_nombre || null, cred.autor, cred.licencia, cred.fuente, art.id, SUBIDO_POR]);
      resumen.importadas++;
    }

    // versión nueva del artículo, mismo texto, con la foto como principal
    const [rev] = await q(
      `insert into wiki.revision (articulo_id, contenido, resumen, autor, basada_en, estado, fecha_revision, imagen_id)
       values ($1, $2, $3, $4, $5, 'aprobada', now(), $6) returning id`,
      [art.id, art.contenido, `Foto principal: ${archivo.nombre}`, AUTOR_VERSION, art.revision_actual, archivo.id]);
    await q(`insert into wiki.revision_archivo (revision_id, archivo_id) values ($1, $2) on conflict do nothing`, [rev.id, archivo.id]);
    await q(`update wiki.articulo set revision_actual = $1 where id = $2`, [rev.id, art.id]);
    art.revision_actual = rev.id; art.imagen_id = archivo.id;
    await q(`insert into wiki.archivo_uso (articulo_id, archivo_id) values ($1, $2) on conflict do nothing`, [art.id, archivo.id]);
    await q(`insert into wiki.registro (accion, articulo_id, revision_id, usuario, detalle) values ('importar', $1, $2, $3, $4)`,
      [art.id, rev.id, SUBIDO_POR, `Foto principal: ${archivo.nombre}`]);
  }
  if (PRUEBA) await db.query('rollback'); else await db.query('commit');
} catch (e) {
  await db.query('rollback');
  for (const d of creadas) await rm(d, { recursive: true, force: true });
  console.error('Error, no se ha guardado nada:', e.message);
  process.exit(1);
} finally {
  if (PRUEBA) await rm(DIR_DESTINO, { recursive: true, force: true });
  await db.end();
}

console.log(`${PRUEBA ? '[PRUEBA: deshecho] ' : ''}Fotos importadas: ${resumen.importadas}, reutilizadas: ${resumen.reutilizadas}`);
if (resumen.conFoto.length) console.log(`Saltadas porque el artículo ya tiene foto principal (${resumen.conFoto.length}): ${resumen.conFoto.join(', ')}`);
if (resumen.sinArticulo.length) console.log(`Sin artículo (${resumen.sinArticulo.length}): ${resumen.sinArticulo.join(', ')}`);
if (resumen.errores.length) console.log(`Errores (${resumen.errores.length}):\n  ${resumen.errores.join('\n  ')}`);
