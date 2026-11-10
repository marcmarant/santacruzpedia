// Subida de una foto desde el editor (wiki.js). Recibe multipart/form-data con:
//   archivo (el fichero), nombre, descripcion (pie) y autor (si la foto es de otra persona).
// Devuelve JSON: { archivo: { nombre, huella, … } } o { errores: [...] }. La foto queda pendiente hasta que se
// apruebe la propuesta que la use (ver src/lib/archivos.ts).
import type { APIRoute } from 'astro';
import { subirArchivo, vistaArchivo, LIMITES_FOTOS } from '../../lib/archivos';

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const usuario = locals.usuario;
  if (!usuario) return json({ errores: ['Tienes que iniciar sesión.'] }, 401);
  // margen para los demás campos del formulario
  if (Number(request.headers.get('content-length') ?? 0) > LIMITES_FOTOS.bytes + 64 * 1024) {
    return json({ errores: [`La foto no puede pasar de ${LIMITES_FOTOS.bytes / 1024 / 1024} MB.`] }, 413);
  }
  let f: FormData;
  try { f = await request.formData(); } catch { return json({ errores: ['No se ha recibido ninguna foto.'] }, 400); }
  const fichero = f.get('archivo');
  if (!(fichero instanceof File) || !fichero.size) return json({ errores: ['No se ha recibido ninguna foto.'] }, 400);

  const r = await subirArchivo({
    datos: Buffer.from(await fichero.arrayBuffer()),
    nombre: String(f.get('nombre') || fichero.name || ''),
    descripcion: String(f.get('descripcion') ?? ''),
    autor: String(f.get('autor') ?? ''),
    usuario,
  });
  if ('errores' in r) return json({ errores: r.errores }, 422);
  return json({ archivo: vistaArchivo(r.archivo), yaExistia: !!r.yaExistia });
};
