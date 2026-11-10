// Foto de un colegial (o silueta si no tiene)
import type { APIRoute } from 'astro';
import { fotoColegial, SILUETA } from '../../lib/fotos';

export const GET: APIRoute = async ({ params }) => {
  const foto = await fotoColegial(params.id!);
  const cabeceras = { 'Cache-Control': 'public, max-age=86400' };
  return foto
    ? new Response(new Uint8Array(foto), { headers: { ...cabeceras, 'Content-Type': 'image/jpeg' } })
    : new Response(SILUETA, { headers: { ...cabeceras, 'Content-Type': 'image/svg+xml' } });
};
