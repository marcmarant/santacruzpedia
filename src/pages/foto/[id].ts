// Dirección antigua de la foto de un colegial: redirige a su foto actual (la principal de su artículo) o a la silueta
import type { APIRoute } from 'astro';
import { urlFoto } from '../../lib/fotos';

export const GET: APIRoute = ({ params, redirect }) => redirect(urlFoto(params.id!, 800), 302);
