// Fotos subidas a la wiki (tabla wiki.archivo, migración 016).
//
// Cómo funcionan:
//   1. Un lector sube una foto desde el editor (POST /archivo/subir). Se procesa (se gira según la cámara, se le
//      quitan los datos EXIF/GPS y se generan 3 tamaños en WebP) y se guarda como 'pendiente' en
//      <ARCHIVOS_DIR>/pendientes/<huella>/. Solo la ven quien la subió y los moderadores.
//   2. Al enviar la propuesta, las fotos que usa quedan ligadas a ella (wiki.revision_archivo) y se mueven a la
//      carpeta de su artículo: <tipo>/<artículo>/<nombre>-<huella>/ (p. ej. eventos/fiesta-de-la-cruz-2019/cena-3fa9c1e2).
//   3. Al aprobarla se publican; al rechazarla se borran (si ninguna otra propuesta pendiente las usa).
//   4. Las que se suben y no llegan a usarse en ninguna propuesta se borran a las 24 horas (limpiarHuerfanos).
//
// En el texto: [[Archivo:Nombre.jpg|opciones|pie]] y bloques <galeria>…</galeria> (ver wikitexto.ts).
// En disco, cada foto tiene original.<formato> (sin metadatos) y 1600.webp, 800.webp y 320.webp.
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, dirname } from 'node:path';
import sharp from 'sharp';
import { ARCHIVOS_DIR } from 'astro:env/server';
import { pool, consulta } from './db';
import type { Usuario } from './auth';
import type { TipoArticulo } from './wiki';

export const DIR = isAbsolute(ARCHIVOS_DIR) ? ARCHIVOS_DIR : join(process.cwd(), ARCHIVOS_DIR);
export const TAMANOS = [1600, 800, 320] as const;
export type Tamano = typeof TAMANOS[number];

export const LIMITES_FOTOS = {
  bytes: 20 * 1024 * 1024,     // 20 MB por foto
  pixeles: 80_000_000,         // 80 megapíxeles (evita imágenes «bomba»)
  porHora: 40,                 // fotos por hora y lector (los moderadores no tienen límite)
  porPropuesta: 20,            // fotos nuevas por propuesta
  nombre: 150, descripcion: 500, autor: 200,
};

export interface Archivo {
  id: number; nombre: string; huella: string; carpeta: string; formato: 'jpg' | 'png' | 'webp';
  ancho: number; alto: number; bytes: number;
  descripcion: string | null; autor: string | null; licencia: string | null; fuente: string | null;
  estado: 'pendiente' | 'publicado'; articulo_id: string | null; usuario_id: number | null; subido_por: string; fecha: Date;
}

const CAMPOS = `id, nombre, huella, carpeta, formato, ancho, alto, bytes, descripcion, autor, licencia, fuente, estado,
                articulo_id, usuario_id, subido_por, fecha`;

// ---------- nombres y URLs ----------

const EXTENSIONES: Record<string, Archivo['formato']> = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp' };

/** «cena_de gala.JPG » → «Cena de gala.JPG» (como en Wikipedia: los _ son espacios y la primera letra va en mayúscula) */
export function normalizarNombre(nombre: string) {
  const n = nombre.replace(/^\s*archivo\s*:/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}
/** clave para buscar por nombre sin importar mayúsculas */
export const claveNombre = (nombre: string) => normalizarNombre(nombre).toLowerCase();

export const urlArchivo = (nombre: string) => `/archivo/${encodeURIComponent(normalizarNombre(nombre).replace(/ /g, '_'))}`;
export const urlImagen = (a: Pick<Archivo, 'huella'>, tam: Tamano | 'original') =>
  `/archivo/${a.huella}/${tam === 'original' ? 'original' : `${tam}.webp`}`;

/** lo que necesita el editor (wiki.js) de cada foto */
export const vistaArchivo = (a: Archivo) => ({
  nombre: a.nombre, huella: a.huella, descripcion: a.descripcion, autor: a.autor ?? a.subido_por,
  estado: a.estado, miniatura: urlImagen(a, 320), url: urlArchivo(a.nombre),
});

/** crédito para mostrar bajo la foto: «Foto: Fulano · CC BY-SA 4.0» */
export const credito = (a: Pick<Archivo, 'autor' | 'subido_por' | 'licencia'>) =>
  `Foto: ${a.autor || a.subido_por}${a.licencia ? ` · ${a.licencia}` : ''}`;

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'foto';

/** carpeta de cada tipo de artículo */
const CARPETA_TIPO: Record<TipoArticulo, string> = {
  colegial: 'colegiales', curso: 'cursos', habitacion: 'habitaciones', evento: 'eventos', tipo_evento: 'tipos-de-evento',
  estudio: 'estudios', director: 'directores', localidad: 'localidades', libro: 'libros', autor: 'autores', libre: 'otros',
};
const carpetaFinal = (a: Archivo, articulo: { id: string; tipo: TipoArticulo }) =>
  `${CARPETA_TIPO[articulo.tipo] ?? 'otros'}/${articulo.id}/${slug(a.nombre.replace(/\.[a-z]+$/i, ''))}-${a.huella.slice(0, 8)}`;

export const rutaFichero = (a: Archivo, tam: Tamano | 'original') =>
  join(DIR, a.carpeta, tam === 'original' ? `original.${a.formato}` : `${tam}.webp`);

// ---------- consultas ----------

/** fotos publicadas (las carga cargarWiki para tenerlas en memoria) */
export const archivosPublicados = () => consulta<Archivo>(`select ${CAMPOS} from wiki.archivo where estado = 'publicado'`);

export async function archivoPorHuella(huella: string): Promise<Archivo | null> {
  if (!/^[0-9a-f]{16}$/.test(huella)) return null;
  return (await consulta<Archivo>(`select ${CAMPOS} from wiki.archivo where huella = $1`, [huella]))[0] ?? null;
}

export async function archivoPorNombre(nombre: string): Promise<Archivo | null> {
  return (await consulta<Archivo>(`select ${CAMPOS} from wiki.archivo where lower(nombre) = $1`, [claveNombre(nombre)]))[0] ?? null;
}

/** ¿puede este usuario ver la foto? Las publicadas, todos; las pendientes, quien la subió y los moderadores */
export const puedeVer = (a: Archivo, u: Usuario | undefined | null) =>
  a.estado === 'publicado' || (!!u && (u.rol === 'moderador' || a.usuario_id === u.id));

/** fotos pendientes que ha subido un usuario (para la vista previa y para no perderlas al recargar el editor) */
export async function pendientesDeUsuario(usuarioId: number) {
  return consulta<Archivo & { en_propuesta: boolean }>(
    `select ${CAMPOS.replace(/(\w+)/g, 'a.$1')},
            exists (select 1 from wiki.revision_archivo ra where ra.archivo_id = a.id) as en_propuesta
     from wiki.archivo a where a.usuario_id = $1 and a.estado = 'pendiente' order by a.fecha`, [usuarioId]);
}

/** fotos que usa una propuesta (para el panel de moderación) */
export async function archivosDeRevisiones(ids: number[]) {
  if (!ids.length) return new Map<number, Archivo[]>();
  const filas = await consulta<Archivo & { revision_id: number }>(
    `select ra.revision_id, ${CAMPOS.replace(/(\w+)/g, 'a.$1')}
     from wiki.revision_archivo ra join wiki.archivo a on a.id = ra.archivo_id
     where ra.revision_id = any($1) order by a.nombre`, [ids]);
  const m = new Map<number, Archivo[]>();
  for (const f of filas) m.set(f.revision_id, [...(m.get(f.revision_id) ?? []), f]);
  return m;
}

/** artículos en los que aparece una foto publicada */
export const usosDe = (archivoId: number) => consulta<{ id: string; titulo: string }>(
  `select a.id, a.titulo from wiki.archivo_uso u join wiki.articulo a on a.id = u.articulo_id
   where u.archivo_id = $1 and a.revision_actual is not null order by a.titulo`, [archivoId]);

// ---------- subir ----------

export interface DatosSubida { datos: Buffer; nombre: string; descripcion: string; autor: string; usuario: Usuario }
export type ResultadoSubida = { archivo: Archivo; yaExistia?: boolean } | { errores: string[] };

/** comprueba, procesa y guarda una foto como pendiente */
export async function subirArchivo(p: DatosSubida): Promise<ResultadoSubida> {
  const errores: string[] = [];
  let nombre = normalizarNombre(p.nombre);
  const descripcion = p.descripcion.replace(/\s+/g, ' ').trim();
  const autor = p.autor.replace(/\s+/g, ' ').trim();

  if (p.datos.length > LIMITES_FOTOS.bytes) return { errores: [`La foto no puede pasar de ${LIMITES_FOTOS.bytes / 1024 / 1024} MB.`] };
  let meta: sharp.Metadata;
  try {
    meta = await sharp(p.datos, { limitInputPixels: LIMITES_FOTOS.pixeles }).metadata();
  } catch {
    return { errores: ['El archivo no es una imagen válida (se admiten JPG, PNG y WebP).'] };
  }
  const formato = meta.format === 'jpeg' ? 'jpg' : meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : null;
  if (!formato) return { errores: ['Formato no admitido: sube la foto en JPG, PNG o WebP.'] };
  if ((meta.pages ?? 1) > 1) return { errores: ['No se admiten imágenes animadas.'] };

  // la extensión del nombre tiene que ser la del formato real
  const ext = nombre.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!ext || EXTENSIONES[ext] !== formato) nombre = `${ext && EXTENSIONES[ext] ? nombre.replace(/\.[a-z0-9]+$/i, '') : nombre}.${formato}`;
  const base = nombre.replace(/\.[a-z0-9]+$/i, '');

  if (!base) errores.push('Escribe un nombre para la foto.');
  if (nombre.length > LIMITES_FOTOS.nombre) errores.push(`El nombre no puede pasar de ${LIMITES_FOTOS.nombre} caracteres.`);
  if (/[[\]{}|#<>/\\:]/.test(base)) errores.push('El nombre no puede llevar los caracteres [ ] { } | # < > / \\ :');
  if (descripcion.length > LIMITES_FOTOS.descripcion) errores.push(`El pie no puede pasar de ${LIMITES_FOTOS.descripcion} caracteres.`);
  if (autor.length > LIMITES_FOTOS.autor) errores.push(`El autor no puede pasar de ${LIMITES_FOTOS.autor} caracteres.`);
  if (p.usuario.rol !== 'moderador') {
    const [{ n }] = await consulta<{ n: number }>(
      `select count(*)::int n from wiki.archivo where usuario_id = $1 and fecha > now() - interval '1 hour'`, [p.usuario.id]);
    if (n >= LIMITES_FOTOS.porHora) errores.push('Has subido demasiadas fotos en la última hora. Inténtalo más tarde.');
  }
  if (errores.length) return { errores };

  // la misma foto ya subida: se reutiliza si se puede ver
  const huella = createHash('sha256').update(p.datos).digest('hex').slice(0, 16);
  const previa = await archivoPorHuella(huella);
  if (previa) {
    return puedeVer(previa, p.usuario)
      ? { archivo: previa, yaExistia: true }
      : { errores: ['Otra persona ya ha subido esta misma foto y está pendiente de revisión.'] };
  }
  const mismoNombre = await archivoPorNombre(nombre);
  if (mismoNombre) return { errores: [`Ya hay una foto llamada «${mismoNombre.nombre}». Elige otro nombre.`] };

  const carpeta = `pendientes/${huella}`;
  const destino = join(DIR, carpeta);
  try {
    await guardarVersiones(p.datos, formato, destino);
  } catch (e) {
    await rm(destino, { recursive: true, force: true });
    console.error('No se pudo procesar la foto:', (e as Error).message);
    return { errores: ['No se ha podido procesar la foto. Prueba con otra o en otro formato.'] };
  }
  const girada = (meta.orientation ?? 1) >= 5;   // las fotos de móvil en vertical vienen giradas 90°
  try {
    const [a] = await consulta<Archivo>(
      `insert into wiki.archivo (nombre, huella, carpeta, formato, ancho, alto, bytes, descripcion, autor, usuario_id, subido_por)
       values ($1, $2, $3, $4, $5, $6, $7, nullif($8, ''), nullif($9, ''), $10, $11) returning ${CAMPOS}`,
      [nombre, huella, carpeta, formato, girada ? meta.height : meta.width, girada ? meta.width : meta.height, p.datos.length,
       descripcion, autor, p.usuario.id, p.usuario.nombre]);
    return { archivo: a };
  } catch (e: any) {
    await rm(destino, { recursive: true, force: true });
    if (e?.code === '23505') return { errores: ['Ya hay una foto con ese nombre o esa misma foto. Elige otro nombre.'] };
    throw e;
  }
}

/** original sin metadatos + los tres tamaños en WebP */
async function guardarVersiones(datos: Buffer, formato: Archivo['formato'], destino: string) {
  await mkdir(destino, { recursive: true });
  const base = () => sharp(datos, { limitInputPixels: LIMITES_FOTOS.pixeles }).rotate();   // rotate(): según EXIF
  const original = formato === 'jpg' ? base().jpeg({ quality: 92, mozjpeg: true })
    : formato === 'png' ? base().png({ compressionLevel: 9 })
    : base().webp({ quality: 92 });
  await writeFile(join(destino, `original.${formato}`), await original.toBuffer());
  for (const t of TAMANOS) {
    const buf = await base().resize({ width: t, height: t, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    await writeFile(join(destino, `${t}.webp`), buf);
  }
}

// ---------- mover y borrar ----------

/** mueve a la carpeta de su artículo las fotos recién ligadas a una propuesta (se llama después del commit) */
export async function moverAPropuesta(ids: number[], articulo: { id: string; tipo: TipoArticulo }) {
  if (!ids.length) return;
  const filas = await consulta<Archivo>(
    `select ${CAMPOS} from wiki.archivo where id = any($1) and estado = 'pendiente' and carpeta like 'pendientes/%'`, [ids]);
  for (const a of filas) {
    const nueva = carpetaFinal(a, articulo);
    try {
      await mkdir(dirname(join(DIR, nueva)), { recursive: true });
      await rm(join(DIR, nueva), { recursive: true, force: true });
      await rename(join(DIR, a.carpeta), join(DIR, nueva));
      await pool.query(`update wiki.archivo set carpeta = $2, articulo_id = $3 where id = $1`, [a.id, nueva, articulo.id]);
    } catch (e) {
      // si falla se queda en pendientes/ (sigue funcionando, solo cambia dónde está)
      console.error(`No se pudo mover la foto ${a.nombre}:`, (e as Error).message);
    }
  }
}

/** borra fotos pendientes (fila y ficheros) */
export async function borrarPendientes(ids: number[]) {
  if (!ids.length) return;
  const filas = await consulta<{ carpeta: string }>(
    `delete from wiki.archivo where id = any($1) and estado = 'pendiente' returning carpeta`, [ids]);
  for (const f of filas) await rm(join(DIR, f.carpeta), { recursive: true, force: true });
}

/** fotos subidas hace más de 24 horas que no usa ninguna propuesta */
export async function limpiarHuerfanos() {
  const filas = await consulta<{ id: number }>(
    `select a.id from wiki.archivo a
     where a.estado = 'pendiente' and a.fecha < now() - interval '24 hours'
       and not exists (select 1 from wiki.revision_archivo ra where ra.archivo_id = a.id)`);
  await borrarPendientes(filas.map(f => f.id));
  if (filas.length) console.log(`Borradas ${filas.length} fotos subidas que no se usaron en ninguna propuesta.`);
}
