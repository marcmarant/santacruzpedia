// Las URLs de la versión anterior (/colegial/2021plato, /curso/2024-2025…) llevan al artículo correspondiente
import { urlDe } from './urls';
import type { TipoArticulo } from './wiki';

export function redirigirAArticulo(tipo: TipoArticulo, clave: unknown): Response {
  const url = urlDe(tipo, clave);
  return url
    ? new Response(null, { status: 301, headers: { Location: url } })
    : new Response(null, { status: 302, headers: { Location: `/buscar?q=${encodeURIComponent(String(clave))}` } });
}
