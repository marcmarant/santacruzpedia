// Convierte el texto de un artículo (Markdown + [[enlaces]] + {{bloques}}) en trozos listos para pintar.
//
//   [[Título]]            enlace a otro artículo (azul si existe, rojo si no)
//   [[Título|texto]]      enlace mostrando otro texto
//   [[Categoría:Nombre]]  añade el artículo a una categoría (no se muestra en el texto)
//   {{nombre}}            sitio donde va un bloque automático (tabla, galería…) generado desde los datos
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { esc } from './formato';
import { resolverTitulo, type Wiki } from './wiki';
import { urlArticulo, urlNuevo } from './urls';

export type Segmento = { tipo: 'html'; html: string } | { tipo: 'bloque'; nombre: string };

const RE_CATEGORIA = /\[\[\s*categor[ií]a\s*:\s*([^\]|]+?)\s*(?:\|[^\]]*)?\]\]\n?/gi;
const RE_ENLACE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
const RE_BLOQUE = /\{\{\s*([a-z_]+)\s*\}\}/g;
const desescapar = (s: string) => s.replace(/\\([\\*_[\]`])/g, '$1');   // quita los escapes de Markdown

/** enlaces y categorías de un texto (para guardarlos en wiki.enlace y wiki.articulo_categoria al aprobar) */
export function analizarWikitexto(contenido: string, w: Wiki) {
  const categorias = new Set<string>();
  const texto = contenido.replace(RE_CATEGORIA, (_, c: string) => { categorias.add(c.trim()); return ''; });
  const enlaces = new Map<string, string | null>();   // título -> id del artículo (null = enlace rojo)
  for (const [, titulo] of texto.matchAll(RE_ENLACE)) {
    const t = desescapar(titulo).trim();
    if (!enlaces.has(t)) enlaces.set(t, resolverTitulo(w, t)?.articulo.id ?? null);
  }
  return { enlaces, categorias: [...categorias] };
}

export function renderizarWikitexto(contenido: string, w: Wiki): { segmentos: Segmento[]; categorias: string[] } {
  const categorias: string[] = [];
  let texto = contenido.replace(RE_CATEGORIA, (_, c: string) => { categorias.push(c.trim()); return ''; });

  // los enlaces se sustituyen por marcas que Markdown no toca; al final se cambian por <a>
  const enlaces: string[] = [];
  texto = texto.replace(RE_ENLACE, (_, titulo: string, visible?: string) => {
    const r = resolverTitulo(w, desescapar(titulo));
    const mostrar = esc(desescapar(visible ?? titulo));
    enlaces.push(r
      ? `<a href="${urlArticulo(r.articulo.id)}" title="${esc(r.articulo.titulo)}">${mostrar}</a>`
      : `<a class="new" href="${urlNuevo(desescapar(titulo).trim())}" title="${esc(titulo)} (la página no existe)">${mostrar}</a>`);
    return `${enlaces.length - 1}`;
  });

  const segmentos: Segmento[] = [];
  const trozos = texto.split(RE_BLOQUE);           // [md, nombreBloque, md, nombreBloque, md…]
  trozos.forEach((trozo, i) => {
    if (i % 2 === 1) { segmentos.push({ tipo: 'bloque', nombre: trozo }); return; }
    if (!trozo.trim()) return;
    const html = sanitizeHtml(marked.parse(trozo, { async: false, gfm: true }) as string)
      .replace(/(\d+)/g, (_, n) => enlaces[+n]);
    segmentos.push({ tipo: 'html', html });
  });
  return { segmentos, categorias };
}
