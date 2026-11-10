// Cerrar sesión (formulario POST desde la cabecera)
import type { APIRoute } from 'astro';
import { cerrarSesion } from '../lib/auth';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  await cerrarSesion(cookies);
  return redirect('/login', 303);
};
export const GET: APIRoute = ({ redirect }) => redirect('/', 302);
