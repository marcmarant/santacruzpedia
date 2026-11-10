// Cuentas de usuario y sesiones.
//
// Toda la wiki requiere iniciar sesión (ver src/middleware.ts). Cada cuenta suele ir unida a un colegial.
// Roles: 'lector' (ver y proponer cambios) y 'moderador' (además, /admin).
// Las cuentas se crean por invitación (enlace de un solo uso que genera un moderador) o por
// solicitud de acceso que un moderador aprueba. El primer moderador se crea con
//   npm run crear-moderador
import type { AstroCookies } from 'astro';
import { pool, consulta } from './db';
import { cifrarContrasena, comprobarContrasena, HASH_FALSO, nuevoToken, hashToken } from './contrasenas';

export interface Usuario {
  id: number; usuario: string; nombre: string; rol: 'lector' | 'moderador'; colegial_id: string | null;
}

export const COOKIE = 'sesion';
const DURACION_SESION_DIAS = 30;
const DURACION_INVITACION_DIAS = 7;
const MAX_FALLOS = 5, VENTANA_FALLOS_MIN = 15;

// ---------- sesiones ----------

/** usuario de la sesión de la cookie, o null */
export async function usuarioDeSesion(cookies: AstroCookies): Promise<Usuario | null> {
  const token = cookies.get(COOKIE)?.value;
  if (!token) return null;
  const [u] = await consulta<Usuario>(
    `select u.id, u.usuario, u.nombre, u.rol, u.colegial_id
     from wiki.sesion s join wiki.usuario u on u.id = s.usuario_id
     where s.id = $1 and s.expira > now() and u.activo`, [hashToken(token)]);
  return u ?? null;
}

async function abrirSesion(usuarioId: number, cookies: AstroCookies, https: boolean, ip: string | null, navegador: string | null) {
  const token = nuevoToken();
  await pool.query(
    `insert into wiki.sesion (id, usuario_id, expira, ip, navegador) values ($1, $2, now() + $3 * interval '1 day', $4, left($5, 300))`,
    [hashToken(token), usuarioId, DURACION_SESION_DIAS, ip, navegador]);
  await pool.query(`update wiki.usuario set ultimo_acceso = now() where id = $1`, [usuarioId]);
  await pool.query(`delete from wiki.sesion where expira < now()`);   // limpieza de sesiones caducadas
  cookies.set(COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: https, maxAge: DURACION_SESION_DIAS * 24 * 3600,
  });
}

export async function cerrarSesion(cookies: AstroCookies) {
  const token = cookies.get(COOKIE)?.value;
  if (token) await pool.query(`delete from wiki.sesion where id = $1`, [hashToken(token)]);
  cookies.delete(COOKIE, { path: '/' });
}

// ---------- inicio de sesión ----------

interface Peticion { cookies: AstroCookies; https: boolean; ip: string | null; navegador: string | null }

/** comprueba usuario y contraseña y abre la sesión. Devuelve un mensaje de error o null */
export async function iniciarSesion(usuario: string, contrasena: string, p: Peticion): Promise<string | null> {
  const nombre = usuario.trim().toLowerCase();
  const [{ fallos }] = await consulta<{ fallos: number }>(
    `select count(*)::int fallos from wiki.intento_login
     where not exito and fecha > now() - $3 * interval '1 minute' and (usuario = $1 or ip = $2)`,
    [nombre, p.ip, VENTANA_FALLOS_MIN]);
  if (fallos >= MAX_FALLOS) return `Demasiados intentos fallidos. Espera ${VENTANA_FALLOS_MIN} minutos y vuelve a probar.`;

  const [u] = await consulta<{ id: number; hash_password: string; activo: boolean }>(
    `select id, hash_password, activo from wiki.usuario where usuario = $1`, [nombre]);
  const correcta = await comprobarContrasena(contrasena, u?.hash_password ?? HASH_FALSO);
  const ok = !!u && u.activo && correcta;
  await pool.query(`insert into wiki.intento_login (usuario, ip, exito) values ($1, $2, $3)`, [nombre.slice(0, 64), p.ip, ok]);
  await pool.query(`delete from wiki.intento_login where fecha < now() - interval '30 days'`);
  if (!ok) return 'Usuario o contraseña incorrectos.';
  await abrirSesion(u.id, p.cookies, p.https, p.ip, p.navegador);
  return null;
}

/** solo rutas internas, para que /login?volver=… no pueda mandar a otra web */
export const destinoSeguro = (v: string | null) => (v && /^\/(?!\/)/.test(v) ? v : '/');

// ---------- invitaciones ----------

/** crea un enlace de invitación para un colegial. Devuelve el token (solo se muestra una vez) */
export async function crearInvitacion(colegialId: string, rol: 'lector' | 'moderador', creadaPor: number): Promise<string> {
  const token = nuevoToken();
  await pool.query(
    `insert into wiki.invitacion (token_hash, colegial_id, rol, creada_por, expira) values ($1, $2, $3, $4, now() + $5 * interval '1 day')`,
    [hashToken(token), colegialId, rol, creadaPor, DURACION_INVITACION_DIAS]);
  return token;
}

export async function leerInvitacion(token: string) {
  const [inv] = await consulta<{ colegial_id: string; rol: 'lector' | 'moderador'; mote: string; nombre: string | null; tiene_cuenta: boolean }>(
    `select i.colegial_id, i.rol, c.mote, c.nombre,
            exists (select 1 from wiki.usuario u where u.colegial_id = i.colegial_id) as tiene_cuenta
     from wiki.invitacion i join colegial c on c.id = i.colegial_id
     where i.token_hash = $1 and i.usada is null and i.expira > now()`, [hashToken(token)]);
  return inv ?? null;
}

/** usa la invitación: crea la cuenta (usuario = id del colegial) y abre la sesión */
export async function aceptarInvitacion(token: string, contrasena: string, p: Peticion): Promise<string | null> {
  const inv = await leerInvitacion(token);
  if (!inv) return 'La invitación no es válida o ha caducado.';
  if (inv.tiene_cuenta) return 'Este colegial ya tiene una cuenta. Inicia sesión.';
  const hash = await cifrarContrasena(contrasena);
  const c = await pool.connect();
  let id: number;
  try {
    await c.query('begin');
    const { rowCount } = await c.query(`update wiki.invitacion set usada = now() where token_hash = $1 and usada is null`, [hashToken(token)]);
    if (!rowCount) { await c.query('rollback'); return 'La invitación ya se ha usado.'; }
    ({ rows: [{ id }] } = await c.query(
      `insert into wiki.usuario (usuario, colegial_id, nombre, hash_password, rol) values ($1, $1, $2, $3, $4) returning id`,
      [inv.colegial_id, inv.mote, hash, inv.rol]));
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  await abrirSesion(id, p.cookies, p.https, p.ip, p.navegador);
  return null;
}

// ---------- solicitudes de acceso ----------

export async function crearSolicitud(colegialId: string, nombre: string, nota: string, contrasena: string, ip: string | null): Promise<string | null> {
  const [col] = await consulta<{ tiene_cuenta: boolean; pendiente: boolean }>(
    `select exists (select 1 from wiki.usuario where colegial_id = $1) as tiene_cuenta,
            exists (select 1 from wiki.solicitud_acceso where colegial_id = $1 and estado = 'pendiente') as pendiente
     from colegial where id = $1`, [colegialId]);
  if (!col) return 'Elige quién eres en la lista.';
  if (col.tiene_cuenta) return 'Ese colegial ya tiene cuenta. Si eres tú y no recuerdas la contraseña, pide ayuda a un moderador.';
  if (col.pendiente) return 'Ya hay una solicitud pendiente para ese colegial.';
  const [{ n }] = await consulta<{ n: number }>(`select count(*)::int n from wiki.solicitud_acceso where ip = $1 and fecha > now() - interval '1 day'`, [ip]);
  if (ip && n >= 5) return 'Has enviado demasiadas solicitudes hoy.';
  await pool.query(
    `insert into wiki.solicitud_acceso (colegial_id, nombre, nota, hash_password, ip) values ($1, $2, nullif($3, ''), $4, $5)`,
    [colegialId, nombre.trim().slice(0, 100), nota.trim().slice(0, 500), await cifrarContrasena(contrasena), ip]);
  return null;
}

export async function solicitudesPendientes() {
  return consulta<{ id: number; colegial_id: string; mote: string; nombre_colegial: string | null; promocion: number | null; nombre: string; nota: string | null; fecha: Date }>(
    `select s.id, s.colegial_id, c.mote, c.nombre as nombre_colegial, c.promocion, s.nombre, s.nota, s.fecha
     from wiki.solicitud_acceso s join colegial c on c.id = s.colegial_id
     where s.estado = 'pendiente' order by s.fecha`);
}

export async function resolverSolicitud(id: number, aprobar: boolean, moderador: Usuario): Promise<string | null> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rows: [s] } = await c.query(
      `select s.*, col.mote from wiki.solicitud_acceso s join colegial col on col.id = s.colegial_id
       where s.id = $1 and s.estado = 'pendiente' for update`, [id]);
    if (!s) { await c.query('rollback'); return 'La solicitud ya no está pendiente.'; }
    if (aprobar) {
      const { rows: [ya] } = await c.query(`select 1 from wiki.usuario where colegial_id = $1`, [s.colegial_id]);
      if (ya) { await c.query('rollback'); return 'Ese colegial ya tiene cuenta.'; }
      await c.query(`insert into wiki.usuario (usuario, colegial_id, nombre, hash_password) values ($1, $1, $2, $3)`,
        [s.colegial_id, s.mote, s.hash_password]);
    }
    await c.query(`update wiki.solicitud_acceso set estado = $2, revisada_por = $3, fecha_revision = now() where id = $1`,
      [id, aprobar ? 'aprobada' : 'rechazada', moderador.id]);
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  return null;
}

// ---------- gestión de cuentas ----------

export async function listarUsuarios() {
  return consulta<{ id: number; usuario: string; nombre: string; colegial_id: string | null; rol: string; activo: boolean; creado: Date; ultimo_acceso: Date | null }>(
    `select id, usuario, nombre, colegial_id, rol, activo, creado, ultimo_acceso from wiki.usuario order by rol desc, nombre`);
}

export async function cambiarUsuario(id: number, cambio: 'activar' | 'desactivar' | 'hacer_moderador' | 'hacer_lector', yo: Usuario): Promise<string | null> {
  if (id === yo.id) return 'No puedes cambiar tu propia cuenta desde aquí.';
  const sql = {
    activar: `update wiki.usuario set activo = true where id = $1`,
    desactivar: `update wiki.usuario set activo = false where id = $1`,
    hacer_moderador: `update wiki.usuario set rol = 'moderador' where id = $1`,
    hacer_lector: `update wiki.usuario set rol = 'lector' where id = $1`,
  }[cambio];
  await pool.query(sql, [id]);
  if (cambio === 'desactivar') await pool.query(`delete from wiki.sesion where usuario_id = $1`, [id]);   // le cierra las sesiones
  return null;
}
