// URLs de la wiki: los artículos siempre se enlazan por su id (/articulo/<id>)
import { wiki } from './estado';
import { claveDato, type TipoArticulo } from './wiki';

export const urlArticulo = (id: string) => `/articulo/${encodeURIComponent(id)}`;

/** URL del artículo de un dato (colegial, curso…) o null si todavía no tiene artículo */
export function urlDe(tipo: TipoArticulo, clave: unknown): string | null {
  const a = wiki().porDato.get(claveDato(tipo, clave));
  return a ? urlArticulo(a.id) : null;
}

/** artículo de un dato, para mostrar su título en enlaces */
export const articuloDe = (tipo: TipoArticulo, clave: unknown) => wiki().porDato.get(claveDato(tipo, clave)) ?? null;

export const urlNuevo = (titulo: string) => `/articulo/nuevo?titulo=${encodeURIComponent(titulo)}`;
export const urlColegio = () => urlDe('libre', 'colegio-mayor-santa-cruz') ?? '/';
export { urlFoto } from './fotos';   // foto principal del artículo del colegial (o silueta)
