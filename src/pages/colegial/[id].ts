// URL antigua: redirige al artículo
import type { APIRoute } from 'astro';
import { redirigirAArticulo } from '../../lib/redireccionVieja';

export const GET: APIRoute = ({ params }) => redirigirAArticulo('colegial', params.id);
