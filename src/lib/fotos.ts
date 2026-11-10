// Fotos de los colegiales.
//   1. Si existe fotos/<id>.jpg en el proyecto, se usa esa (p. ej. retratos históricos).
//   2. Si no, se pide al servidor del colegio y se guarda en memoria.
// Los créditos de las fotos locales están en fotos/creditos.json ({ "<id>": "texto del crédito" }).
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REMOTE_ASSETS } from 'astro:env/server';

const CARPETA = join(process.cwd(), 'fotos');
const cache = new Map<string, Buffer | null>();   // null = no tiene foto

const creditos: Record<string, string> = existsSync(join(CARPETA, 'creditos.json'))
  ? JSON.parse(readFileSync(join(CARPETA, 'creditos.json'), 'utf8'))
  : {};
export const creditoFoto = (id: string): string | null => creditos[id] ?? null;

async function fotoLocal(id: string): Promise<Buffer | null> {
  if (!/^[a-z0-9_-]+$/i.test(id)) return null;
  try { return await readFile(join(CARPETA, `${id}.jpg`)); } catch { return null; }
}

export async function fotoColegial(id: string): Promise<Buffer | null> {
  if (cache.has(id)) return cache.get(id)!;
  const local = await fotoLocal(id);
  if (local) { cache.set(id, local); return local; }
  try {
    const r = await fetch(`${REMOTE_ASSETS}/assets/cmusantacruz/profile_photos/${encodeURIComponent(id)}.jpg`, { signal: AbortSignal.timeout(5000) });
    const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    cache.set(id, buf);
    return buf;
  } catch {
    return null;   // error de red: no se guarda, se reintentará
  }
}

export const tieneFoto = (id: string) => cache.get(id) != null;

/** descarga todas las fotos en segundo plano para que la portada pueda elegir un colegial con foto */
export async function precargarFotos(ids: string[]) {
  for (const id of ids) if (!cache.has(id)) await fotoColegial(id);
}

export const SILUETA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 380"><rect width="300" height="380" fill="#eaecf0"/><circle cx="150" cy="140" r="70" fill="#a2a9b1"/><path d="M30 380c0-80 55-140 120-140s120 60 120 140z" fill="#a2a9b1"/></svg>`;
