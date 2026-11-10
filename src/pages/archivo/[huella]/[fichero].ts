// Ficheros de una foto: /archivo/<huella>/1600.webp | 800.webp | 320.webp | original
// Las publicadas las ve cualquiera con sesión; las pendientes, solo quien las subió y los moderadores.
// Como la huella cambia si cambia la foto, el navegador puede guardarlas para siempre (immutable).
import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { wiki } from '../../../lib/estado';
import { archivoPorHuella, puedeVer, rutaFichero, TAMANOS, type Tamano } from '../../../lib/archivos';

const TIPOS = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

export const GET: APIRoute = async ({ params, locals }) => {
  const huella = params.huella!, fichero = params.fichero!;
  const tam = fichero === 'original' ? 'original' : TAMANOS.find(t => fichero === `${t}.webp`);
  if (!tam) return new Response(null, { status: 404 });

  const a = wiki().archivosPorHuella.get(huella) ?? await archivoPorHuella(huella);
  if (!a || !puedeVer(a, locals.usuario)) return new Response(null, { status: 404 });

  let datos: Buffer;
  try { datos = await readFile(rutaFichero(a, tam as Tamano | 'original')); }
  catch { return new Response(null, { status: 404 }); }
  return new Response(new Uint8Array(datos), {
    headers: {
      'Content-Type': tam === 'original' ? TIPOS[a.formato] : 'image/webp',
      'Cache-Control': a.estado === 'publicado' ? 'private, max-age=31536000, immutable' : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(tam === 'original' ? { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nombre)}` } : {}),
    },
  });
};
