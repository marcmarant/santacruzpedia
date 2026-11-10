// Planos de cada planta (están en el servidor del colegio)
import type { APIRoute } from 'astro';
import { REMOTE_ASSETS } from 'astro:env/server';
import { PLANOS } from '../../lib/formato';

export const GET: APIRoute = ({ params, redirect }) => {
  const archivo = PLANOS[Number(params.piso)];
  return archivo ? redirect(`${REMOTE_ASSETS}/habitaciones/assets/${archivo}`) : new Response(null, { status: 404 });
};
