// Fotos de los colegiales: la foto principal de su artículo (wiki.archivo, ver archivos.ts).
// Si no tiene, se muestra una silueta (public/silueta.svg).
// Las fotos de perfil antiguas (profile_photos del servidor) se pasaron a este sistema con scripts/importar-fotos.mjs.
import { wiki } from './estado';
import { claveDato } from './wiki';
import { urlImagen, type Archivo, type Tamano } from './archivos';

export const SILUETA = '/silueta.svg';

/** foto principal del artículo de un colegial, o null */
export function fotoDeColegial(colegialId: string): Archivo | null {
  const w = wiki();
  const a = w.porDato.get(claveDato('colegial', colegialId));
  return a?.imagen_id != null ? w.archivosPorId.get(a.imagen_id) ?? null : null;
}

export const tieneFoto = (colegialId: string) => fotoDeColegial(colegialId) != null;

/** URL de la foto de un colegial (o de la silueta) */
export function urlFoto(colegialId: string, tam: Tamano = 320) {
  const f = fotoDeColegial(colegialId);
  return f ? urlImagen(f, tam) : SILUETA;
}
