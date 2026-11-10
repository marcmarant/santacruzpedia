// Mantiene en memoria los datos y el índice de artículos, y los recarga cada cierto tiempo
import { cargarDatos, type Datos } from './datos';
import { cargarWiki, type Wiki } from './wiki';

const REFRESCO_DATOS = 5 * 60_000;   // datos del colegio: cada 5 minutos
const REFRESCO_WIKI = 30_000;        // artículos: cada 30 segundos (cambian al aprobar propuestas)

let D: Datos | null = null;
let W: Wiki | null = null;
let cargando: Promise<void> | null = null;

async function recargar(soloWiki = false) {
  const [d, w] = await Promise.all([soloWiki ? Promise.resolve(D!) : cargarDatos(), cargarWiki()]);
  D = d; W = w;
}

/** se llama en cada petición (middleware): la primera vez espera; después refresca en segundo plano */
export async function asegurarCargado() {
  if (!D || !W) { cargando ??= recargar().finally(() => { cargando = null; }); await cargando; return; }
  const ahora = Date.now();
  const caducaDatos = ahora - D.cargado.getTime() > REFRESCO_DATOS;
  const caducaWiki = ahora - W.cargado.getTime() > REFRESCO_WIKI;
  if ((caducaDatos || caducaWiki) && !cargando) {
    cargando = recargar(!caducaDatos).catch(e => console.error('Recarga fallida:', e.message)).finally(() => { cargando = null; });
  }
}

/** recarga los artículos al momento (después de aprobar una propuesta) */
export async function recargarWikiYa() {
  W = await cargarWiki();
}

/** recarga datos y artículos al momento (después de añadir o modificar registros desde /admin) */
export async function recargarTodoYa() {
  await recargar();
}

export const datos = (): Datos => D!;
export const wiki = (): Wiki => W!;
