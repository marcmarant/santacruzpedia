// Fotos de los colegiales.
//   1. Si existe fotos/<id>.jpg en el proyecto, se usa esa (p. ej. retratos históricos).
//   2. Si no, se pide al servidor del colegio y se guarda en memoria un rato: pasado ese tiempo se vuelve a
//      preguntar (con If-None-Match, así que si no ha cambiado no se descarga otra vez). Así las fotos que se
//      suben o cambian en el servidor aparecen sin reiniciar la wiki.
// Los créditos de las fotos locales están en fotos/creditos.json ({ "<id>": "texto del crédito" }).
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { REMOTE_ASSETS } from 'astro:env/server';

const CARPETA = join(process.cwd(), 'fotos');
const VIGENCIA_CON_FOTO = 30 * 60_000;   // cada cuánto se comprueba si una foto ha cambiado
const VIGENCIA_SIN_FOTO = 5 * 60_000;    // cada cuánto se comprueba si alguien sin foto ya la tiene

export interface Foto { datos: Buffer; version: string }   // version: huella del contenido (para el ETag)
interface Entrada { foto: Foto | null; etagRemoto: string | null; hasta: number }
const cache = new Map<string, Entrada>();   // foto null = no tiene foto

const nuevaFoto = (datos: Buffer): Foto => ({ datos, version: createHash('sha1').update(datos).digest('hex').slice(0, 16) });

const creditos: Record<string, string> = existsSync(join(CARPETA, 'creditos.json'))
  ? JSON.parse(readFileSync(join(CARPETA, 'creditos.json'), 'utf8'))
  : {};
export const creditoFoto = (id: string): string | null => creditos[id] ?? null;

async function fotoLocal(id: string): Promise<Buffer | null> {
  if (!/^[a-z0-9_-]+$/i.test(id)) return null;
  try { return await readFile(join(CARPETA, `${id}.jpg`)); } catch { return null; }
}

export async function fotoColegial(id: string): Promise<Foto | null> {
  const previa = cache.get(id);
  if (previa && previa.hasta > Date.now()) return previa.foto;
  if (!previa) {
    const local = await fotoLocal(id);
    if (local) { const foto = nuevaFoto(local); cache.set(id, { foto, etagRemoto: null, hasta: Infinity }); return foto; }
  }
  try {
    const r = await fetch(`${REMOTE_ASSETS}/assets/cmusantacruz/profile_photos/${encodeURIComponent(id)}.jpg`, {
      signal: AbortSignal.timeout(5000),
      headers: previa?.foto && previa.etagRemoto ? { 'If-None-Match': previa.etagRemoto } : {},
    });
    if (r.status === 304 && previa) {
      previa.hasta = Date.now() + VIGENCIA_CON_FOTO;
      return previa.foto;
    }
    const foto = r.ok ? nuevaFoto(Buffer.from(await r.arrayBuffer())) : null;
    cache.set(id, { foto, etagRemoto: r.ok ? r.headers.get('etag') : null, hasta: Date.now() + (foto ? VIGENCIA_CON_FOTO : VIGENCIA_SIN_FOTO) });
    return foto;
  } catch {
    return previa?.foto ?? null;   // error de red: se sirve lo que hubiera y se reintentará en la próxima petición
  }
}

export const tieneFoto = (id: string) => cache.get(id)?.foto != null;

/** descarga todas las fotos en segundo plano para que la portada pueda elegir un colegial con foto */
export async function precargarFotos(ids: string[]) {
  for (const id of ids) if (!cache.has(id)) await fotoColegial(id);
}

export const SILUETA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 380"><rect width="300" height="380" fill="#eaecf0"/><circle cx="150" cy="140" r="70" fill="#a2a9b1"/><path d="M30 380c0-80 55-140 120-140s120 60 120 140z" fill="#a2a9b1"/></svg>`;
