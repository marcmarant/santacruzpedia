// Artículos de la wiki (esquema wiki): índice por id, por título, por redirección y por dato vinculado
import { consulta } from './db';

export type TipoArticulo =
  | 'colegial' | 'curso' | 'habitacion' | 'evento' | 'tipo_evento' | 'estudio'
  | 'director' | 'localidad' | 'libro' | 'autor' | 'libre';

export interface Articulo {
  id: string; titulo: string; tipo: TipoArticulo;
  colegial_id: string | null; curso_id: string | null; habitacion_id: number | null;
  evento_curso: string | null; evento_nombre: string | null; tipo_evento_id: number | null;
  estudio_id: string | null; director_id: string | null; localidad: string | null;
  libro_id: number | null; autor_id: number | null;
  revision_actual: number | null;
  contenido: string | null;              // texto publicado (Markdown)
  rev_fecha: Date | null; rev_autor: string | null;
}

export interface Wiki {
  porId: Map<string, Articulo>;
  porTitulo: Map<string, Articulo>;                               // título en minúsculas
  redirecciones: Map<string, { titulo: string; articulo: Articulo }>; // título en minúsculas
  porDato: Map<string, Articulo>;                                 // claveDato(tipo, clave)
  idsAntiguos: Map<string, string>;
  cargado: Date;
}

/** artículo libre que aún no está publicado (propuesta de artículo nuevo), para mostrar cómo quedaría */
export const articuloBorrador = (id: string, titulo: string, contenido: string): Articulo => ({
  id, titulo, tipo: 'libre', contenido,
  colegial_id: null, curso_id: null, habitacion_id: null, evento_curso: null, evento_nombre: null, tipo_evento_id: null,
  estudio_id: null, director_id: null, localidad: null, libro_id: null, autor_id: null,
  revision_actual: null, rev_fecha: null, rev_autor: null,
});

/** clave para encontrar el artículo de un dato: claveDato('colegial', '2021plato') */
export const claveDato = (tipo: TipoArticulo, clave: unknown) => `${tipo}:${String(clave)}`;

function claveDeArticulo(a: Articulo): string | null {
  switch (a.tipo) {
    case 'colegial': return a.colegial_id && claveDato('colegial', a.colegial_id);
    case 'curso': return a.curso_id && claveDato('curso', a.curso_id);
    case 'habitacion': return a.habitacion_id != null ? claveDato('habitacion', a.habitacion_id) : null;
    case 'evento': return a.evento_curso && claveDato('evento', `${a.evento_curso}|${a.evento_nombre}`);
    case 'tipo_evento': return a.tipo_evento_id != null ? claveDato('tipo_evento', a.tipo_evento_id) : null;
    case 'estudio': return a.estudio_id && claveDato('estudio', a.estudio_id);
    case 'director': return a.director_id && claveDato('director', a.director_id);
    case 'localidad': return a.localidad && claveDato('localidad', a.localidad);
    case 'libro': return a.libro_id != null ? claveDato('libro', a.libro_id) : null;
    case 'autor': return a.autor_id != null ? claveDato('autor', a.autor_id) : null;
    case 'libre': return claveDato('libre', a.id);
  }
}

export async function cargarWiki(): Promise<Wiki> {
  const [arts, redirs, antiguos] = await Promise.all([
    consulta<Articulo>(`select a.*, r.contenido, r.fecha as rev_fecha, r.autor as rev_autor
                        from wiki.articulo a join wiki.revision r on r.id = a.revision_actual`),  // sin publicar (propuestos): fuera
    consulta<{ titulo: string; articulo_id: string }>('select titulo, articulo_id from wiki.redireccion'),
    consulta<{ id_viejo: string; articulo_id: string }>('select id_viejo, articulo_id from wiki.id_antiguo'),
  ]);
  const porId = new Map(arts.map(a => [a.id, a]));
  const porDato = new Map<string, Articulo>();
  for (const a of arts) { const k = claveDeArticulo(a); if (k) porDato.set(k, a); }
  const redirecciones = new Map<string, { titulo: string; articulo: Articulo }>();
  for (const r of redirs) { const a = porId.get(r.articulo_id); if (a) redirecciones.set(r.titulo.toLowerCase(), { titulo: r.titulo, articulo: a }); }
  return {
    porId,
    porTitulo: new Map(arts.map(a => [a.titulo.toLowerCase(), a])),
    redirecciones,
    porDato,
    idsAntiguos: new Map(antiguos.map(x => [x.id_viejo, x.articulo_id])),
    cargado: new Date(),
  };
}

/** busca un título como lo haría un [[enlace]]: primero títulos, luego redirecciones */
export function resolverTitulo(w: Wiki, titulo: string): { articulo: Articulo; desde?: string } | null {
  const k = titulo.trim().toLowerCase();
  const a = w.porTitulo.get(k);
  if (a) return { articulo: a };
  const r = w.redirecciones.get(k);
  return r ? { articulo: r.articulo, desde: r.titulo } : null;
}

export async function historial(articuloId: string) {
  return consulta<{ id: number; fecha: Date; autor: string; resumen: string | null; estado: string; actual: boolean }>(
    `select r.id, r.fecha, r.autor, r.resumen, r.estado, r.id = a.revision_actual as actual
     from wiki.revision r join wiki.articulo a on a.id = r.articulo_id
     where r.articulo_id = $1 order by r.fecha desc, r.id desc`, [articuloId]);
}

export async function loQueEnlazaAqui(articuloId: string) {
  return consulta<{ id: string; titulo: string }>(
    `select a.id, a.titulo from wiki.enlace e join wiki.articulo a on a.id = e.origen_id
     where e.destino_id = $1 order by a.titulo`, [articuloId]);
}
