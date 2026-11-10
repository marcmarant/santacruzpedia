// Página aleatoria: cualquier artículo excepto libros (son la gran mayoría)
import type { APIRoute } from 'astro';
import { wiki } from '../lib/estado';
import { urlArticulo } from '../lib/urls';

export const GET: APIRoute = ({ redirect }) => {
  const arts = [...wiki().porId.values()].filter(a => a.tipo !== 'libro');
  return redirect(urlArticulo(arts[Math.floor(Math.random() * arts.length)].id));
};
