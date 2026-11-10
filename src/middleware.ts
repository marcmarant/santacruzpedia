// Antes de cada página:
//   1. se asegura de que los datos y artículos estén cargados en memoria
//   2. exige haber iniciado sesión en toda la wiki (salvo las páginas públicas de acceso)
//   3. /admin solo para moderadores
import { defineMiddleware } from 'astro:middleware';
import { asegurarCargado, datos } from './lib/estado';
import { precargarFotos } from './lib/fotos';
import { usuarioDeSesion } from './lib/auth';

/** páginas que se pueden ver sin sesión */
const PUBLICAS = [/^\/login$/, /^\/solicitar-acceso$/, /^\/invitacion\/[^/]+$/, /\.(css|js|png|ico|svg|jpg|webp)$/];

let fotosPrecargadas = false;

export const onRequest = defineMiddleware(async (ctx, next) => {
  const ruta = ctx.url.pathname;
  const usuario = await usuarioDeSesion(ctx.cookies);
  if (usuario) ctx.locals.usuario = usuario;

  if (!usuario && !PUBLICAS.some(r => r.test(ruta))) {
    const volver = ruta + ctx.url.search;
    return ctx.redirect(volver === '/' ? '/login' : `/login?volver=${encodeURIComponent(volver)}`);
  }
  if (ruta.startsWith('/admin') && usuario?.rol !== 'moderador') {
    return new Response('Solo los moderadores pueden entrar en el panel de moderación.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  await asegurarCargado();
  if (!fotosPrecargadas) {
    fotosPrecargadas = true;
    precargarFotos([...datos().cols.keys()]).catch(() => { fotosPrecargadas = false; });
  }
  return next();
});
