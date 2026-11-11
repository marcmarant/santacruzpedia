// Estructura de las tablas del colegio (esquema public), leída de PostgreSQL para generar los formularios
// de «Añadir registros» y «Modificar registros». Las tablas del esquema wiki NO aparecen aquí:
// esos cambios siguen su propio proceso (propuestas, moderación, cuentas…).
import { consulta } from './db';
import { PROVINCIAS } from './formato';

export type TipoCampo = 'texto' | 'texto_largo' | 'entero' | 'decimal' | 'fecha' | 'booleano' | 'opciones';

export interface Columna {
  nombre: string;
  etiqueta: string;
  tipo: TipoCampo;
  tipoSql: string;                       // p. ej. 'character varying(16)'
  obligatoria: boolean;
  automatica: boolean;                   // tiene valor por defecto de una secuencia (id autonumérico)
  longitud: number | null;
  opciones?: { valor: string; texto: string }[];   // enums, dominios y checks del tipo «x in (…)»
  referencia?: { tabla: string; columna: string }; // clave foránea
  ayuda?: string;
}

export interface Tabla {
  nombre: string;
  titulo: string;
  descripcion: string;
  columnas: Columna[];
  clave: string[];                       // clave primaria
}

// Nombres legibles y explicaciones de tablas y columnas
const TABLAS: Record<string, [string, string]> = {
  colegial: ['Colegiales', 'Cada colegial: mote, nombre, procedencia, padrino…'],
  colegial_curso: ['Estancias', 'Qué colegial estuvo en qué curso, en qué habitación y qué estudiaba'],
  apodo: ['Apodos', 'Otros apodos de un colegial, además de su mote'],
  curso: ['Cursos', 'Cursos académicos (AAAA-AAAA) y su director'],
  director: ['Directores', 'Directores del colegio'],
  decano: ['Decanos', 'El decano de cada curso'],
  consejo: ['Consejeros', 'Los consejeros de cada curso (4 como máximo)'],
  premio: ['Premios', 'Premios Diego de Muros, Víctor Verde y colegiales de honor'],
  evento: ['Eventos', 'Eventos de cada curso (fiestas, viajes, capeas…)'],
  tipo_evento: ['Tipos de evento', 'Agrupa las ediciones de un mismo evento a lo largo de los cursos'],
  habitacion: ['Habitaciones', 'Habitaciones del colegio'],
  planta: ['Plantas', 'Plantas del edificio'],
  estudio: ['Estudios', 'Titulaciones que cursan los colegiales'],
  ubicacion: ['Localidades', 'Localidades de procedencia'],
  libro: ['Libros', 'Libros de la biblioteca'],
  autor: ['Autores', 'Autores de los libros'],
  libro_autor: ['Autores de cada libro', 'Une libros con sus autores'],
  genero: ['Géneros literarios', 'Géneros de los libros'],
};
const ETIQUETAS: Record<string, string> = {
  'colegial.pid': 'Padrino', 'colegial.promocion': 'Promoción', 'colegial.id': 'Id', 'colegialid': 'Colegial', 'cursoid': 'Curso',
  'curso.directorid': 'Director', 'director.catedra': 'Cátedra',
  'evento.info': 'Crónica', 'evento.tipo_id': 'Tipo de evento', 'libro.genero_id': 'Género', 'libro.fecha': 'Año',
  'libro.localizacion': 'Estantería', 'libro.isbn': 'ISBN', 'libro_autor.libro_id': 'Libro', 'libro_autor.autor_id': 'Autor',
  'habitacion.piso': 'Planta', 'habitacion.superficie': 'Superficie (m²)', 'ubicacion.pais': 'País (código ISO)',
  'colegial_curso.habitacion': 'Habitación', 'colegial_curso.estudio': 'Estudios', 'apodo.apodo': 'Apodo',
};
const AYUDAS: Record<string, string> = {
  'colegial.id': 'Por convención: año de ingreso + mote en minúsculas, sin espacios (p. ej. 2026arepa).',
  'curso.id': 'Formato AAAA-AAAA, años consecutivos (p. ej. 2027-2028).',
  'ubicacion.pais': 'Dos letras: ES, GB, VE…',
  'premio.cursoid': 'Obligatorio salvo para «colegial de honor».',
};
/** columnas antiguas de fotos que ya no se usan: las fotos van ahora en la wiki (wiki.archivo, src/lib/archivos.ts).
 *  No salen en los formularios; al añadir quedan vacías y al modificar se conservan como estén. */
const OCULTAS = new Set(['colegial.foto_perfil', 'colegial.foto_insignia', 'evento.fotosurl',
  'evento.info']);   // la crónica de un evento se escribe en su artículo (los 6 que la tenían ya la llevan en el texto)
/** columnas de tipo text que se editan en una caja grande (el resto, como las URLs de fotos, en una línea) */
const TEXTOS_LARGOS = new Set(['info', 'descripcion', 'observaciones']);
const humanizar = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/** columna que se muestra para describir un registro de cada tabla en los desplegables */
export const COLUMNA_ETIQUETA: Record<string, string> = {
  colegial: 'mote', curso: 'id', director: 'nombre', estudio: 'nombre', ubicacion: 'localidad', habitacion: 'id',
  libro: 'titulo', autor: 'nombre', genero: 'nombre', tipo_evento: 'nombre', planta: 'nombre',
};

let cache: { tablas: Map<string, Tabla>; hora: number } | null = null;

export async function tablas(): Promise<Map<string, Tabla>> {
  if (cache && Date.now() - cache.hora < 5 * 60_000) return cache.tablas;

  const [cols, pks, fks, enums, checks] = await Promise.all([
    consulta<{ tabla: string; col: string; tipo: string; typname: string; typtype: string; no_nulo: boolean; defecto: string | null; dom_check: string | null; typoid: number }>(
      `select c.relname tabla, a.attname col, format_type(a.atttypid, a.atttypmod) tipo, t.typname, t.typtype::text typtype,
              a.attnotnull as no_nulo, pg_get_expr(d.adbin, d.adrelid) defecto, t.oid::int typoid,
              (select string_agg(pg_get_constraintdef(k.oid), ' ') from pg_constraint k where k.contypid = t.oid) dom_check
       from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       join pg_type t on t.oid = a.atttypid
       left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
       where c.relkind = 'r' order by c.relname, a.attnum`),
    consulta<{ tabla: string; cols: string[] }>(
      `select k.conrelid::regclass::text tabla, array_agg(a.attname::text order by x.ord) cols
       from pg_constraint k cross join unnest(k.conkey) with ordinality x(num, ord)
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.num
       where k.contype = 'p' and k.connamespace = 'public'::regnamespace group by 1`),
    consulta<{ tabla: string; col: string; ref_tabla: string; ref_col: string }>(
      `select k.conrelid::regclass::text tabla, a.attname col, k.confrelid::regclass::text ref_tabla, r.attname ref_col
       from pg_constraint k
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
       join pg_attribute r on r.attrelid = k.confrelid and r.attnum = k.confkey[1]
       where k.contype = 'f' and k.connamespace = 'public'::regnamespace and array_length(k.conkey, 1) = 1`),
    consulta<{ typname: string; etiquetas: string[] }>(
      `select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) etiquetas
       from pg_type t join pg_enum e on e.enumtypid = t.oid group by 1`),
    consulta<{ tabla: string; col: string; def: string }>(
      `select k.conrelid::regclass::text tabla, a.attname col, pg_get_constraintdef(k.oid) def
       from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
       where k.contype = 'c' and k.connamespace = 'public'::regnamespace and array_length(k.conkey, 1) = 1`),
  ]);

  const enumsPorTipo = new Map(enums.map(e => [e.typname, e.etiquetas]));
  const valoresDeCheck = (def: string) => def.includes('ANY (ARRAY[') ? [...def.matchAll(/'([^']*)'::/g)].map(m => m[1]) : null;
  const res = new Map<string, Tabla>();

  for (const c of cols) {
    const t = res.get(c.tabla) ?? (() => {
      const [titulo, descripcion] = TABLAS[c.tabla] ?? [humanizar(c.tabla), ''];
      const nueva: Tabla = { nombre: c.tabla, titulo, descripcion, columnas: [], clave: [] };
      res.set(c.tabla, nueva);
      return nueva;
    })();
    const clave = `${c.tabla}.${c.col}`;
    if (OCULTAS.has(clave)) continue;
    let tipo: TipoCampo =
      /^(integer|smallint|bigint)/.test(c.tipo) ? 'entero' :
      /^(double|real|numeric)/.test(c.tipo) ? 'decimal' :
      c.tipo === 'date' ? 'fecha' : c.tipo === 'boolean' ? 'booleano' :
      c.tipo === 'text' && TEXTOS_LARGOS.has(c.col) ? 'texto_largo' : 'texto';
    let opciones: Columna['opciones'];
    if (c.typtype === 'e') opciones = (enumsPorTipo.get(c.typname) ?? []).map(v => ({ valor: v, texto: humanizar(v) }));
    if (c.typtype === 'd' && c.dom_check) {
      const vals = valoresDeCheck(c.dom_check);
      if (vals) opciones = vals.map(v => ({ valor: v, texto: c.typname === 'provincia_es' ? `${PROVINCIAS[v] ?? v} (${v})` : v }));
    }
    const check = checks.find(k => k.tabla === c.tabla && k.col === c.col && valoresDeCheck(k.def));
    if (check) opciones = valoresDeCheck(check.def)!.map(v => ({ valor: v, texto: humanizar(v) }));
    if (opciones) tipo = 'opciones';
    const fk = fks.find(f => f.tabla === c.tabla && f.col === c.col);
    t.columnas.push({
      nombre: c.col, etiqueta: ETIQUETAS[clave] ?? ETIQUETAS[c.col] ?? humanizar(c.col), tipo, tipoSql: c.tipo,
      obligatoria: c.no_nulo && !c.defecto, automatica: !!c.defecto?.startsWith('nextval('),
      longitud: Number(c.tipo.match(/\((\d+)\)/)?.[1]) || null, opciones,
      referencia: fk ? { tabla: fk.ref_tabla, columna: fk.ref_col } : undefined,
      ayuda: AYUDAS[clave],
    });
  }
  for (const p of pks) { const t = res.get(p.tabla); if (t) t.clave = p.cols; }

  // orden: primero las tablas con nombre conocido, en el orden de TABLAS
  const orden = Object.keys(TABLAS);
  const ordenadas = new Map([...res].sort((a, b) =>
    (orden.indexOf(a[0]) + 1 || 99) - (orden.indexOf(b[0]) + 1 || 99) || a[0].localeCompare(b[0])));
  cache = { tablas: ordenadas, hora: Date.now() };
  return ordenadas;
}

/** nombre de tabla o columna entre comillas dobles (solo se usa con nombres que vienen de la propia base de datos) */
export const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
