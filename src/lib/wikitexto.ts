// Convierte el texto de un artículo (Markdown + [[enlaces]] + {{bloques}} + fotos) en trozos listos para pintar.
//
//   [[Título]]            enlace a otro artículo (azul si existe, rojo si no)
//   [[Título|texto]]      enlace mostrando otro texto
//   [[Categoría:Nombre]]  añade el artículo a una categoría (no se muestra en el texto)
//   {{nombre}}            sitio donde va un bloque automático (tabla, galería…) generado desde los datos
//   [[Archivo:Foto.jpg]]  foto a la derecha; opciones separadas por |: izquierda, derecha, centro, grande,
//                         y el último texto que no sea una opción es el pie: [[Archivo:Foto.jpg|izquierda|La cena]]
//   <galeria>             cuadrícula de fotos, una por línea:  Archivo:Foto.jpg|Pie de foto
//   …</galeria>
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { esc } from './formato';
import { resolverTitulo, type Wiki } from './wiki';
import { urlArticulo, urlNuevo } from './urls';
import { claveNombre, normalizarNombre, urlArchivo, urlImagen, type Archivo } from './archivos';

export type Segmento = { tipo: 'html'; html: string } | { tipo: 'bloque'; nombre: string };

const RE_CATEGORIA = /\[\[\s*categor[ií]a\s*:\s*([^\]|]+?)\s*(?:\|[^\]]*)?\]\]\n?/gi;
const RE_ARCHIVO = /\[\[\s*archivo\s*:\s*([^\]|]+?)\s*((?:\|[^\]]*)?)\]\]/gi;
const RE_GALERIA = /<galeria>([\s\S]*?)<\/galeria>/gi;
const RE_ENLACE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
const RE_BLOQUE = /\{\{\s*([a-z_]+)\s*\}\}/g;
const OPCIONES = new Set(['izquierda', 'derecha', 'centro', 'grande', 'miniatura']);
const desescapar = (s: string) => s.replace(/\\([\\*_[\]`])/g, '$1');   // quita los escapes de Markdown

/** fotos de una galería: una por línea, «Archivo:Nombre|pie» (el «Archivo:» es opcional) */
function lineasGaleria(cuerpo: string) {
  return cuerpo.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [nombre, ...resto] = l.split('|');
    return { nombre: normalizarNombre(desescapar(nombre)), pie: resto.join('|').trim() };
  }).filter(f => f.nombre);
}

/** nombres de las fotos que usa un texto (en el texto y en galerías) */
export function fotosDelTexto(contenido: string): string[] {
  const nombres = new Set<string>();
  for (const [, nombre] of contenido.matchAll(RE_ARCHIVO)) nombres.add(normalizarNombre(desescapar(nombre)));
  for (const [, cuerpo] of contenido.matchAll(RE_GALERIA)) for (const f of lineasGaleria(cuerpo)) nombres.add(f.nombre);
  return [...nombres];
}

/**
 * Texto escrito por alguien en un artículo de evento, en texto plano: sin categorías, bloques, fotos, títulos
 * de sección ni la frase automática con la que se creó («La X fue un evento celebrado durante el curso…»).
 * Vacío si nadie ha escrito nada sobre el evento (sirve para saber si tiene crónica y para resumirla).
 */
export function textoPropioEvento(contenido: string | null | undefined): string {
  return (contenido ?? '')
    .replace(RE_CATEGORIA, '').replace(RE_GALERIA, '').replace(RE_ARCHIVO, '').replace(RE_BLOQUE, '')
    .replace(/^La \*\*.+?\*\* fue un evento celebrado durante el curso .*?\.\s*$/m, '')
    .replace(/^#+.*$/gm, '')
    .replace(RE_ENLACE, (_, titulo: string, visible?: string) => visible ?? titulo)
    .replace(/[*_`>]|^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ').trim();
}

/** enlaces y categorías de un texto (para guardarlos en wiki.enlace y wiki.articulo_categoria al aprobar) */
export function analizarWikitexto(contenido: string, w: Wiki) {
  const categorias = new Set<string>();
  const texto = contenido.replace(RE_CATEGORIA, (_, c: string) => { categorias.add(c.trim()); return ''; })
    .replace(RE_GALERIA, '').replace(RE_ARCHIVO, '');
  const enlaces = new Map<string, string | null>();   // título -> id del artículo (null = enlace rojo)
  for (const [, titulo] of texto.matchAll(RE_ENLACE)) {
    const t = desescapar(titulo).trim();
    if (!enlaces.has(t)) enlaces.set(t, resolverTitulo(w, t)?.articulo.id ?? null);
  }
  return { enlaces, categorias: [...categorias] };
}

/** busca una foto: primero las publicadas y luego las de `extra` (pendientes visibles en la vista previa) */
export const buscarFoto = (w: Wiki, nombre: string, extra?: Map<string, Archivo>) =>
  w.archivos.get(claveNombre(nombre)) ?? extra?.get(claveNombre(nombre)) ?? null;

/** tamaño en pantalla de la versión de 800 px (para reservar el hueco antes de que cargue) */
function medidas(a: Archivo, max: number) {
  const k = Math.min(1, max / Math.max(a.ancho, a.alto));
  return { ancho: Math.round(a.ancho * k), alto: Math.round(a.alto * k) };
}

const marcaPendiente = (a: Archivo) => a.estado === 'pendiente' ? '<span class="marca-pendiente">Pendiente de revisión</span>' : '';

function htmlFoto(a: Archivo | null, nombre: string, parametros: string[]) {
  if (!a) return `<span class="foto-falta" title="No hay ninguna foto con este nombre">Falta la foto «${esc(nombre)}»</span>`;
  const opciones = parametros.map(p => p.trim()).filter(p => OPCIONES.has(p.toLowerCase())).map(p => p.toLowerCase());
  const pie = desescapar(parametros.map(p => p.trim()).filter(p => p && !OPCIONES.has(p.toLowerCase())).at(-1) ?? a.descripcion ?? '');
  const lado = opciones.find(o => o === 'izquierda' || o === 'centro') ?? 'derecha';
  const { ancho, alto } = medidas(a, 800);
  return `<span class="foto ${lado}${opciones.includes('grande') ? ' grande' : ''}">`
    + `<a class="foto-img" href="${urlArchivo(a.nombre)}" data-grande="${urlImagen(a, 1600)}" data-pie="${esc(pie)}">`
    + `<img src="${urlImagen(a, 800)}" width="${ancho}" height="${alto}" alt="${esc(pie || a.nombre)}" loading="lazy" /></a>`
    + (pie ? `<span class="pie">${esc(pie)}</span>` : '') + marcaPendiente(a) + `</span>`;
}

function htmlGaleria(cuerpo: string, w: Wiki, extra?: Map<string, Archivo>) {
  const fotos = lineasGaleria(cuerpo);
  if (!fotos.length) return '';
  return `<ul class="galeria-fotos">${fotos.map(f => {
    const a = buscarFoto(w, f.nombre, extra);
    if (!a) return `<li><span class="foto-falta">Falta la foto «${esc(f.nombre)}»</span></li>`;
    const pie = desescapar(f.pie || a.descripcion || '');
    return `<li><a class="foto-img" href="${urlArchivo(a.nombre)}" data-grande="${urlImagen(a, 1600)}" data-pie="${esc(pie)}">`
      + `<img src="${urlImagen(a, 320)}" alt="${esc(pie || a.nombre)}" loading="lazy" /></a>`
      + (pie ? `<span class="pie">${esc(pie)}</span>` : '') + marcaPendiente(a) + `</li>`;
  }).join('')}</ul>`;
}

/**
 * @param extra fotos pendientes que también se pueden mostrar (vista previa del editor y panel de moderación),
 *              indexadas por claveNombre
 */
export function renderizarWikitexto(contenido: string, w: Wiki, extra?: Map<string, Archivo>): { segmentos: Segmento[]; categorias: string[] } {
  const categorias: string[] = [];
  const sinCategorias = contenido.replace(RE_CATEGORIA, (_, c: string) => { categorias.push(c.trim()); return ''; });

  const segmentos: Segmento[] = [];
  // las galerías se separan antes de pasar por Markdown: [texto, galería, texto, galería, texto…]
  sinCategorias.split(RE_GALERIA).forEach((parte, i) => {
    if (i % 2 === 1) { const html = htmlGaleria(parte, w, extra); if (html) segmentos.push({ tipo: 'html', html }); return; }
    segmentos.push(...renderizarTexto(parte, w, extra));
  });
  return { segmentos, categorias };
}

function renderizarTexto(texto: string, w: Wiki, extra?: Map<string, Archivo>): Segmento[] {
  // fotos y enlaces se sustituyen por marcas que Markdown no toca; al final se cambian por su HTML
  const fotos: string[] = [];
  texto = texto.replace(RE_ARCHIVO, (_, nombre: string, parametros: string) => {
    const n = normalizarNombre(desescapar(nombre));
    fotos.push(htmlFoto(buscarFoto(w, n, extra), n, parametros ? parametros.slice(1).split('|') : []));
    return `${fotos.length - 1}`;
  });
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
      .replace(/<p>\s*(\d+)\s*<\/p>/g, (_, n) => fotos[+n])   // foto sola en su línea: sin <p> vacío alrededor
      .replace(/(\d+)/g, (_, n) => fotos[+n])
      .replace(/(\d+)/g, (_, n) => enlaces[+n]);
    segmentos.push({ tipo: 'html', html });
  });
  return segmentos;
}
