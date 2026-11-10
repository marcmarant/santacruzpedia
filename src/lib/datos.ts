// Datos del colegio (esquema public) cargados en memoria con sus relaciones
import { consulta } from './db';

export interface Estancia { curso: string; hab: number | null; estudio: string | null; col: Colegial }
export type TipoPremio = 'diego_de_muros' | 'victor_verde' | 'colegial_de_honor';
export interface Premio { id: number; tipo: TipoPremio; col: Colegial; curso: string | null }
export interface Cargo { curso: string; cargo: 'decano' | 'consejero' }
export interface Colegial {
  id: string; mote: string; nombre: string | null; nacimiento: string | null; procedencia: string | null;
  pid: string | null; fotoInsignia: string | null; promo: number | null;
  apodos: string[]; estancias: Estancia[]; ahijados: Colegial[];
  premios: Premio[]; cargos: Cargo[];
}
export interface Director { id: string; nombre: string; catedra: string | null }
export interface Evento { cursoid: string; nombre: string; info: string | null; inicio: string | null; fin: string | null; fotosurl: string | null }
export interface Curso {
  id: string; directorid: string | null; director?: Director; miembros: Estancia[]; eventos: Evento[];
  decano?: Colegial; consejeros: Colegial[]; premios: Premio[];
}
export interface Estudio { id: string; nombre: string; tipo: string }
export interface Ubicacion { localidad: string; provincia: string | null; pais: string | null }
export interface Habitacion { id: number; superficie: number | null; descripcion: string | null; piso: number | null; historial: Estancia[] }
export interface Libro {
  id: number; titulo: string; autor: string | null; genero: string | null; editorial: string | null;
  observaciones: string | null; fecha: number | null; localizacion: string | null; isbn: string | null;
}

export interface Datos {
  cols: Map<string, Colegial>;
  cursos: Map<string, Curso>;
  actual: string;                       // id del curso más reciente
  directores: Map<string, Director>;
  estudios: Map<string, Estudio>;
  ubic: Map<string, Ubicacion>;
  habs: Map<number, Habitacion>;
  eventos: Evento[];
  libros: Libro[];
  libroPorId: Map<number, Libro>;
  premios: Premio[];
  cargado: Date;
}

export async function cargarDatos(): Promise<Datos> {
  const [colegial, cc, curso, director, estudio, evento, habitacion, libro, ubicacion, apodo, premio, decano, consejo] = await Promise.all([
    consulta('select * from colegial'), consulta('select * from colegial_curso order by cursoid'),
    consulta('select * from curso order by id'), consulta('select * from director'),
    consulta('select * from estudio'), consulta('select * from evento order by cursoid, nombre'),
    consulta('select * from habitacion order by id'), consulta('select * from libro_vista order by id'),
    consulta('select * from ubicacion'), consulta('select * from apodo'),
    consulta('select * from premio order by cursoid nulls last, tipo'),
    consulta('select * from decano'), consulta('select * from consejo order by colegialid'),
  ]);

  const directores = new Map<string, Director>(director.map(d => [d.id, d as Director]));
  const estudios = new Map<string, Estudio>(estudio.map(e => [e.id, e as Estudio]));
  const ubic = new Map<string, Ubicacion>(ubicacion.map(u => [u.localidad, { localidad: u.localidad, provincia: u.provincia, pais: u.pais?.trim() || null }]));
  const habs = new Map<number, Habitacion>(habitacion.map(h => [h.id, { ...(h as Habitacion), historial: [] }]));
  const cursos = new Map<string, Curso>(curso.map(c => [c.id, {
    id: c.id, directorid: c.directorid, director: directores.get(c.directorid), miembros: [], eventos: [], consejeros: [], premios: [],
  }]));
  const cols = new Map<string, Colegial>(colegial.map(c => [c.id, {
    id: c.id, mote: c.mote || c.id, nombre: c.nombre || null, nacimiento: c.nacimiento, procedencia: c.procedencia,
    pid: c.pid, fotoInsignia: c.foto_insignia, promo: c.promocion ?? null, apodos: [], estancias: [], ahijados: [],
    premios: [], cargos: [],
  }]));

  // premios y cargos (decano y consejeros de cada curso)
  const premios: Premio[] = [];
  for (const p of premio) {
    const col = cols.get(p.colegialid); if (!col) continue;
    const pr: Premio = { id: p.id, tipo: p.tipo, col, curso: p.cursoid };
    premios.push(pr); col.premios.push(pr);
    if (p.cursoid) cursos.get(p.cursoid)?.premios.push(pr);
  }
  for (const x of decano) {
    const col = cols.get(x.colegialid), cu = cursos.get(x.cursoid); if (!col || !cu) continue;
    cu.decano = col; col.cargos.push({ curso: x.cursoid, cargo: 'decano' });
  }
  for (const x of consejo) {
    const col = cols.get(x.colegialid), cu = cursos.get(x.cursoid); if (!col || !cu) continue;
    cu.consejeros.push(col); col.cargos.push({ curso: x.cursoid, cargo: 'consejero' });
  }
  for (const c of cols.values()) c.cargos.sort((a, b) => a.curso.localeCompare(b.curso));

  for (const a of apodo) cols.get(a.colegialid)?.apodos.push(a.apodo);
  for (const c of cols.values()) if (c.pid) cols.get(c.pid)?.ahijados.push(c);
  for (const c of cols.values()) c.ahijados.sort((a, b) => a.id.localeCompare(b.id));
  for (const r of cc) {
    const c = cols.get(r.colegialid), cu = cursos.get(r.cursoid);
    if (!c || !cu) continue;
    const e: Estancia = { curso: r.cursoid, hab: r.habitacion, estudio: r.estudio, col: c };
    c.estancias.push(e); cu.miembros.push(e);
    if (r.habitacion != null) habs.get(r.habitacion)?.historial.push(e);
  }
  const eventos = evento as Evento[];
  for (const e of eventos) cursos.get(e.cursoid)?.eventos.push(e);
  const libros = libro as Libro[];

  return {
    cols, cursos, actual: [...cursos.keys()].at(-1)!, directores, estudios, ubic, habs, eventos, libros,
    libroPorId: new Map(libros.map(l => [l.id, l])), premios, cargado: new Date(),
  };
}

/** primer curso del colegial (para saber si fue novato en un curso) */
export const esNovatoEn = (c: Colegial, curso: string) => c.estancias[0]?.curso === curso;
