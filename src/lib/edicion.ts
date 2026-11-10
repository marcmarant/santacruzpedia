// Propuestas de cambio de los lectores y su revisión por los moderadores
import { pool, consulta } from './db';
import { analizarWikitexto } from './wikitexto';
import { recargarWikiYa, wiki } from './estado';
import type { Usuario } from './auth';

export const LIMITES = { contenido: 100_000, resumen: 300, motivo: 1000, propuestasPorHora: 10 };

export interface Propuesta {
  id: number; articulo_id: string; titulo: string; contenido: string; resumen: string | null; autor: string;
  fecha: Date; basada_en: number | null; revision_actual: number | null; contenido_actual: string | null;
}

// ---------- lectores ----------

export interface DatosPropuesta { articuloId: string; contenido: string; usuario: Usuario; resumen: string; basadaEn: number | null; ip: string | null }

/** valida y guarda una propuesta pendiente. Devuelve la lista de errores (vacía si todo fue bien) */
export async function proponerCambio(p: DatosPropuesta): Promise<string[]> {
  const errores: string[] = [];
  const contenido = p.contenido.replace(/\r\n/g, '\n').trim();
  const autor = p.usuario.nombre, resumen = p.resumen.trim();
  const articulo = wiki().porId.get(p.articuloId);

  if (!articulo) errores.push('El artículo no existe.');
  if (resumen.length > LIMITES.resumen) errores.push(`El resumen no puede pasar de ${LIMITES.resumen} caracteres.`);
  if (!contenido) errores.push('El texto no puede quedar vacío.');
  if (contenido.length > LIMITES.contenido) errores.push(`El texto no puede pasar de ${LIMITES.contenido} caracteres.`);
  if (articulo && contenido === (articulo.contenido ?? '').trim()) errores.push('No has cambiado nada del texto.');
  {
    const [{ n }] = await consulta<{ n: number }>(
      `select count(*)::int n from wiki.revision where usuario_id = $1 and fecha > now() - interval '1 hour'`, [p.usuario.id]);
    if (p.usuario.rol !== 'moderador' && n >= LIMITES.propuestasPorHora) errores.push('Has enviado demasiadas propuestas en la última hora. Inténtalo más tarde.');
  }
  if (errores.length) return errores;

  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows: [rev] } = await c.query(
      `insert into wiki.revision (articulo_id, contenido, resumen, autor, usuario_id, ip, basada_en, estado)
       values ($1, $2, nullif($3, ''), $4, $5, $6, $7, 'pendiente') returning id`,
      [p.articuloId, contenido, resumen, autor, p.usuario.id, p.ip, p.basadaEn]);
    await c.query(`insert into wiki.registro (accion, articulo_id, revision_id, usuario, detalle) values ('proponer', $1, $2, $3, $4)`,
      [p.articuloId, rev.id, autor, resumen || null]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback'); throw e;
  } finally { c.release(); }
  return [];
}

/** propuestas enviadas por un usuario, con su estado y el motivo si se rechazó */
export async function misPropuestas(usuarioId: number) {
  return consulta<{
    id: number; articulo_id: string; titulo: string; resumen: string | null; contenido: string;
    fecha: Date; estado: 'pendiente' | 'aprobada' | 'rechazada'; fecha_revision: Date | null; motivo: string | null; actual: boolean;
  }>(
    `select r.id, r.articulo_id, a.titulo, r.resumen, r.contenido, r.fecha, r.estado, r.fecha_revision, r.motivo,
            a.revision_actual = r.id as actual
     from wiki.revision r join wiki.articulo a on a.id = r.articulo_id
     where r.usuario_id = $1
     order by r.fecha desc`, [usuarioId]);
}

export async function pendientesDe(articuloId: string) {
  const [{ n }] = await consulta<{ n: number }>(`select count(*)::int n from wiki.revision where articulo_id = $1 and estado = 'pendiente'`, [articuloId]);
  return n;
}

// ---------- moderadores ----------

export async function propuestasPendientes(): Promise<Propuesta[]> {
  return consulta<Propuesta>(
    `select r.id, r.articulo_id, a.titulo, r.contenido, r.resumen, r.autor, r.fecha, r.basada_en,
            a.revision_actual, act.contenido as contenido_actual
     from wiki.revision r
     join wiki.articulo a on a.id = r.articulo_id
     left join wiki.revision act on act.id = a.revision_actual
     where r.estado = 'pendiente'
     order by r.fecha`);
}

export async function decisionesRecientes(limite = 20) {
  return consulta<{ id: number; articulo_id: string; titulo: string; autor: string; estado: string; fecha_revision: Date; motivo: string | null; revisor: string | null }>(
    `select r.id, r.articulo_id, a.titulo, r.autor, r.estado, r.fecha_revision, r.motivo,
            (select g.usuario from wiki.registro g where g.revision_id = r.id and g.accion in ('aprobar', 'rechazar') order by g.fecha desc limit 1) as revisor
     from wiki.revision r join wiki.articulo a on a.id = r.articulo_id
     where r.estado <> 'pendiente' and r.autor <> 'Santacruzpedia (automático)'
     order by r.fecha_revision desc limit $1`, [limite]);
}

/** publica una propuesta: pasa a ser la versión actual y se recalculan sus enlaces y categorías */
export async function aprobar(revisionId: number, mod: Usuario): Promise<string | null> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows: [r] } = await c.query(
      `select r.id, r.articulo_id, r.contenido from wiki.revision r where r.id = $1 and r.estado = 'pendiente' for update`, [revisionId]);
    if (!r) { await c.query('rollback'); return 'La propuesta ya no está pendiente.'; }
    await c.query(`select 1 from wiki.articulo where id = $1 for update`, [r.articulo_id]);

    await c.query(`update wiki.revision set estado = 'aprobada', revisada_por = $2, fecha_revision = now() where id = $1`, [r.id, mod.id]);
    await c.query(`update wiki.articulo set revision_actual = $1 where id = $2`, [r.id, r.articulo_id]);

    const { enlaces, categorias } = analizarWikitexto(r.contenido, wiki());
    await c.query(`delete from wiki.enlace where origen_id = $1`, [r.articulo_id]);
    for (const [titulo, destino] of enlaces)
      await c.query(`insert into wiki.enlace (origen_id, destino_titulo, destino_id) values ($1, $2, $3)`, [r.articulo_id, titulo, destino]);
    await c.query(`delete from wiki.articulo_categoria where articulo_id = $1`, [r.articulo_id]);
    for (const cat of categorias)
      await c.query(`insert into wiki.articulo_categoria (articulo_id, categoria) values ($1, $2)`, [r.articulo_id, cat]);

    await c.query(`insert into wiki.registro (accion, articulo_id, revision_id, usuario) values ('aprobar', $1, $2, $3)`, [r.articulo_id, r.id, mod.usuario]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback'); throw e;
  } finally { c.release(); }
  await recargarWikiYa();
  return null;
}

export async function rechazar(revisionId: number, motivo: string, mod: Usuario): Promise<string | null> {
  const m = motivo.trim().slice(0, LIMITES.motivo);
  const { rowCount } = await pool.query(
    `update wiki.revision set estado = 'rechazada', revisada_por = $2, fecha_revision = now(), motivo = nullif($3, '')
     where id = $1 and estado = 'pendiente'`, [revisionId, mod.id, m]);
  if (!rowCount) return 'La propuesta ya no está pendiente.';
  await pool.query(
    `insert into wiki.registro (accion, articulo_id, revision_id, usuario, detalle)
     select 'rechazar', articulo_id, id, $2, nullif($3, '') from wiki.revision where id = $1`, [revisionId, mod.usuario, m]);
  return null;
}
