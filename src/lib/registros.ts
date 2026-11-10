// Añadir y modificar registros de las tablas del colegio desde /admin.
// Los nombres de tablas y columnas solo se aceptan si existen en el esquema (ver esquema.ts);
// los valores van siempre como parámetros de la consulta.
import { spawn } from 'node:child_process';
import { pool, consulta } from './db';
import { tablas, ident, COLUMNA_ETIQUETA, type Tabla, type Columna } from './esquema';
import { recargarTodoYa } from './estado';
import type { Usuario } from './auth';

export type Valores = Record<string, unknown>;

export async function tabla(nombre: string | null): Promise<Tabla | null> {
  return nombre ? (await tablas()).get(nombre) ?? null : null;
}

/** clave primaria <-> texto para las URLs */
export const codificarClave = (v: unknown[]) => Buffer.from(JSON.stringify(v)).toString('base64url');
export function decodificarClave(s: string | null): unknown[] | null {
  if (!s) return null;
  try { const v = JSON.parse(Buffer.from(s, 'base64url').toString()); return Array.isArray(v) ? v : null; } catch { return null; }
}

/** opciones para los desplegables de claves foráneas: [valor, texto] */
export async function opcionesReferencia(c: Columna): Promise<{ valor: string; texto: string }[]> {
  if (!c.referencia) return [];
  const t = await tabla(c.referencia.tabla);
  if (!t) return [];
  const col = ident(c.referencia.columna);
  const etiqueta = COLUMNA_ETIQUETA[t.nombre];
  const texto = etiqueta && etiqueta !== c.referencia.columna ? `${ident(etiqueta)}::text || ' (' || ${col}::text || ')'` : `${col}::text`;
  const filas = await consulta<{ valor: string; texto: string }>(
    `select ${col}::text as valor, ${texto} as texto from ${ident(t.nombre)} order by 2`);
  return filas;
}

// ---------- leer ----------

const columnasTexto = (t: Tabla) => t.columnas.filter(c => c.tipo !== 'booleano').map(c => `${ident(c.nombre)}::text`);

export async function listar(t: Tabla, buscar: string, pagina: number, porPagina = 50) {
  const filtro = buscar.trim() ? `where concat_ws(' ', ${columnasTexto(t).join(', ')}) ilike $1` : '';
  const params = buscar.trim() ? [`%${buscar.trim()}%`] : [];
  const orden = t.clave.map(ident).join(', ') || '1';
  const [{ total }] = await consulta<{ total: number }>(`select count(*)::int total from ${ident(t.nombre)} ${filtro}`, params);
  const filas = await consulta(
    `select * from ${ident(t.nombre)} ${filtro} order by ${orden} limit ${porPagina} offset ${Math.max(0, pagina) * porPagina}`, params);
  return { total, filas };
}

export async function obtener(t: Tabla, clave: unknown[]): Promise<Valores | null> {
  if (clave.length !== t.clave.length) return null;
  const where = t.clave.map((c, i) => `${ident(c)}::text = $${i + 1}`).join(' and ');
  const [fila] = await consulta(`select * from ${ident(t.nombre)} where ${where}`, clave.map(String));
  return fila ?? null;
}

// ---------- formularios ----------

/** convierte lo que llega del formulario al tipo de cada columna. Devuelve valores y errores */
export function leerFormulario(t: Tabla, f: FormData, { incluirAutomaticas = false } = {}) {
  const valores: Valores = {};
  const errores: string[] = [];
  for (const c of t.columnas) {
    if (c.automatica && !incluirAutomaticas) continue;
    const bruto = f.get(`c_${c.nombre}`);
    if (c.tipo === 'booleano') { valores[c.nombre] = bruto === 'on'; continue; }
    const s = bruto == null ? '' : String(bruto).replace(/\r\n/g, '\n');
    const limpio = c.tipo === 'texto_largo' ? s : s.trim();
    if (limpio === '') {
      if (c.obligatoria) errores.push(`«${c.etiqueta}» es obligatorio.`);
      valores[c.nombre] = null;
      continue;
    }
    if (c.tipo === 'entero') {
      if (!/^-?\d+$/.test(limpio)) { errores.push(`«${c.etiqueta}» debe ser un número entero.`); continue; }
      valores[c.nombre] = Number(limpio);
    } else if (c.tipo === 'decimal') {
      const n = Number(limpio.replace(',', '.'));
      if (Number.isNaN(n)) { errores.push(`«${c.etiqueta}» debe ser un número.`); continue; }
      valores[c.nombre] = n;
    } else if (c.tipo === 'fecha') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio)) { errores.push(`«${c.etiqueta}» debe ser una fecha.`); continue; }
      valores[c.nombre] = limpio;
    } else {
      if (c.longitud && limpio.length > c.longitud) { errores.push(`«${c.etiqueta}» no puede pasar de ${c.longitud} caracteres.`); continue; }
      if (c.opciones && !c.opciones.some(o => o.valor === limpio)) { errores.push(`«${c.etiqueta}» no tiene un valor permitido.`); continue; }
      valores[c.nombre] = limpio;
    }
  }
  return { valores, errores };
}

/** mensaje comprensible a partir de un error de PostgreSQL */
function explicarError(e: any): string {
  const detalle = e.detail ? ` (${e.detail})` : '';
  switch (e.code) {
    case '23505': return `Ya existe un registro con esos datos${detalle}.`;
    case '23503': return `Uno de los valores apunta a un registro que no existe, o hay otros registros que dependen de este${detalle}.`;
    case '23514': return `Algún valor no cumple las reglas de la tabla (${e.constraint ?? 'restricción'})${detalle}.`;
    case '23502': return `Falta un valor obligatorio${e.column ? `: ${e.column}` : ''}.`;
    case '22001': return 'Algún texto es demasiado largo.';
    case '22P02': case '22007': case '22008': return 'Algún valor no tiene el formato correcto.';
    case 'P0001': return e.message;   // errores lanzados por los triggers (p. ej. «ya tiene 4 consejeros»)
    default: return `No se ha podido guardar: ${e.message}${detalle}`;
  }
}

const sinFechas = (v: Valores) => JSON.parse(JSON.stringify(v, (_, x) => x instanceof Date ? x.toISOString() : x));

// ---------- escribir ----------

export async function insertar(t: Tabla, valores: Valores, u: Usuario): Promise<{ error: string | null; clave?: unknown[] }> {
  const cols = Object.keys(valores);
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows: [fila] } = await c.query(
      `insert into ${ident(t.nombre)} (${cols.map(ident).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
      cols.map(k => valores[k]));
    const clave = t.clave.map(k => fila[k]);
    await c.query(
      `insert into wiki.cambio_datos (usuario_id, usuario, tabla, accion, clave, despues) values ($1, $2, $3, 'insertar', $4, $5)`,
      [u.id, u.nombre, t.nombre, JSON.stringify(clave), JSON.stringify(sinFechas(fila))]);
    await c.query('commit');
    return { error: null, clave };
  } catch (e) {
    await c.query('rollback');
    return { error: explicarError(e) };
  } finally { c.release(); }
}

export async function modificar(t: Tabla, clave: unknown[], valores: Valores, u: Usuario): Promise<{ error: string | null; clave?: unknown[] }> {
  const cols = Object.keys(valores);
  const whereSelect = t.clave.map((k, i) => `${ident(k)}::text = $${i + 1}`).join(' and ');
  const whereUpdate = t.clave.map((k, i) => `${ident(k)}::text = $${cols.length + i + 1}`).join(' and ');
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows: [antes] } = await c.query(`select * from ${ident(t.nombre)} where ${whereSelect} for update`, clave.map(String));
    if (!antes) { await c.query('rollback'); return { error: 'El registro ya no existe.' }; }
    const { rows: [despues] } = await c.query(
      `update ${ident(t.nombre)} set ${cols.map((k, i) => `${ident(k)} = $${i + 1}`).join(', ')} where ${whereUpdate} returning *`,
      [...cols.map(k => valores[k]), ...clave.map(String)]);
    const nuevaClave = t.clave.map(k => despues[k]);
    await c.query(
      `insert into wiki.cambio_datos (usuario_id, usuario, tabla, accion, clave, antes, despues) values ($1, $2, $3, 'modificar', $4, $5, $6)`,
      [u.id, u.nombre, t.nombre, JSON.stringify(nuevaClave), JSON.stringify(sinFechas(antes)), JSON.stringify(sinFechas(despues))]);
    await c.query('commit');
    return { error: null, clave: nuevaClave };
  } catch (e) {
    await c.query('rollback');
    return { error: explicarError(e) };
  } finally { c.release(); }
}

export async function ultimosCambios(limite = 15) {
  return consulta<{ id: number; fecha: Date; usuario: string | null; tabla: string; accion: string; clave: unknown[] }>(
    `select id, fecha, usuario, tabla, accion, clave from wiki.cambio_datos order by fecha desc limit $1`, [limite]);
}

// ---------- después de guardar ----------

/** tablas cuyos registros tienen artículo propio en la wiki */
const CON_ARTICULO = new Set(['colegial', 'curso', 'habitacion', 'evento', 'estudio', 'director', 'ubicacion', 'libro']);

/** recarga los datos en memoria y, si hace falta, crea los artículos de los registros nuevos */
export async function despuesDeGuardar(t: Tabla, esNuevo: boolean): Promise<string | null> {
  let aviso: string | null = null;
  if (esNuevo && CON_ARTICULO.has(t.nombre)) aviso = await crearArticulosQueFalten();
  await recargarTodoYa();
  return aviso;
}

/** ejecuta scripts/importar-articulos.mjs (crea artículos solo para lo que aún no tiene) */
function crearArticulosQueFalten(): Promise<string | null> {
  return new Promise(resolve => {
    const p = spawn(process.execPath, ['scripts/importar-articulos.mjs'], { cwd: process.cwd(), env: process.env });
    let salida = '';
    p.stdout.on('data', d => { salida += d; });
    p.stderr.on('data', d => { salida += d; });
    const reloj = setTimeout(() => { p.kill(); resolve('No se ha podido crear el artículo a tiempo; ejecuta npm run importar-articulos.'); }, 60_000);
    p.on('close', codigo => {
      clearTimeout(reloj);
      const n = salida.match(/Artículos creados: (\d+)/)?.[1];
      resolve(codigo !== 0 ? 'No se ha podido crear el artículo automáticamente; ejecuta npm run importar-articulos.'
        : n && +n > 0 ? `Se ha creado su artículo en la wiki (${n}).` : null);
    });
  });
}
