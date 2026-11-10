// Foto de un colegial (o silueta si no tiene).
// El navegador la guarda poco tiempo y luego pregunta con su ETag: si no ha cambiado se responde 304 (sin
// volver a enviarla), y si se ha subido una foto nueva al servidor la recibe sin tener que vaciar la caché.
import type { APIRoute } from 'astro';
import { fotoColegial, SILUETA } from '../../lib/fotos';

export const GET: APIRoute = async ({ params, request }) => {
  const foto = await fotoColegial(params.id!);
  if (!foto) {
    return new Response(SILUETA, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=300' } });
  }
  const etag = `"${foto.version}"`;
  const cabeceras = { 'Cache-Control': 'private, max-age=600', ETag: etag };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: cabeceras });
  return new Response(new Uint8Array(foto.datos), { headers: { ...cabeceras, 'Content-Type': 'image/jpeg' } });
};
