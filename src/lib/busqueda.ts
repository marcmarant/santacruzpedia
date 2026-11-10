// Búsqueda de artículos por título, redirección (apodos, nombres) y texto
import { norm } from './formato';
import { resolverTitulo, type Articulo, type Wiki } from './wiki';

export interface Resultado { articulo: Articulo; motivo: string; fragmento?: string }

const TIPOS: Record<string, string> = {
  colegial: 'Colegial', curso: 'Curso', habitacion: 'Habitación', evento: 'Evento', estudio: 'Estudios',
  director: 'Director', localidad: 'Localidad', libro: 'Libro', autor: 'Autor', libre: 'Artículo', tipo_evento: 'Evento',
};
export const nombreTipo = (t: string) => TIPOS[t] ?? t;

/** texto plano sin marcas de Markdown ni de wiki, para fragmentos */
const textoPlano = (md: string) => md
  .replace(/\{\{[^}]*\}\}/g, ' ')
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
  .replace(/[*_#`\\]/g, '')
  .replace(/\s+/g, ' ').trim();

/** si la búsqueda coincide exactamente con un título o apodo, a dónde ir directamente */
export function coincidenciaExacta(w: Wiki, q: string) {
  const r = resolverTitulo(w, q);
  if (r) return r;
  const n = q.trim().match(/^(?:habitaci[oó]n\s*)?(\d+)$/i)?.[1];
  const hab = n ? w.porTitulo.get(`habitación ${n}`) : undefined;
  return hab ? { articulo: hab } : null;
}

export function buscar(w: Wiki, q: string, limite = 200): Resultado[] {
  const nq = norm(q).trim();
  if (!nq) return [];
  const vistos = new Set<string>();
  const enTitulo: Resultado[] = [], enRedir: Resultado[] = [], enTexto: Resultado[] = [];

  for (const a of w.porId.values()) {
    if (norm(a.titulo).includes(nq)) { enTitulo.push({ articulo: a, motivo: nombreTipo(a.tipo) }); vistos.add(a.id); }
  }
  for (const r of w.redirecciones.values()) {
    if (!vistos.has(r.articulo.id) && norm(r.titulo).includes(nq)) {
      enRedir.push({ articulo: r.articulo, motivo: `${nombreTipo(r.articulo.tipo)} · también conocido como «${r.titulo}»` });
      vistos.add(r.articulo.id);
    }
  }
  for (const a of w.porId.values()) {
    if (vistos.has(a.id) || !a.contenido) continue;
    const plano = textoPlano(a.contenido);
    const i = norm(plano).indexOf(nq);
    if (i >= 0) {
      const ini = Math.max(0, i - 60);
      enTexto.push({ articulo: a, motivo: nombreTipo(a.tipo), fragmento: (ini ? '…' : '') + plano.slice(ini, i + nq.length + 80) + '…' });
    }
  }
  const exactoPrimero = (x: Resultado, y: Resultado) => +(norm(y.articulo.titulo) === nq) - +(norm(x.articulo.titulo) === nq);
  return [...enTitulo.sort(exactoPrimero), ...enRedir, ...enTexto].slice(0, limite);
}
