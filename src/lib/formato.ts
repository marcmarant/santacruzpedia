// Utilidades de formato y tablas de nombres

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2003-12-10' -> '10 de diciembre de 2003' */
export function fecha(d: string | null | undefined): string {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${+dd} de ${MESES[+m - 1]} de ${y}`;
}

export function edad(d: string): number {
  const n = new Date(d), h = new Date();
  let a = h.getFullYear() - n.getFullYear();
  if (h < new Date(h.getFullYear(), n.getMonth(), n.getDate())) a--;
  return a;
}

/** plural(3, 'colegial', 'colegiales') -> '3 colegiales' */
export const plural = (n: number, s: string, p = s + 's') => `${n} ${n === 1 ? s : p}`;

/** minúsculas y sin tildes, para comparar y buscar */
export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** escapa texto para meterlo en HTML generado a mano */
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const PISOS: Record<number, string> = { 0: 'Post (planta baja)', 1: 'Primer piso', 2: 'Segundo piso' };
export const PLANOS: Record<number, string> = { 0: 'plano-post.jpg', 1: 'plano-primero.jpg', 2: 'plano-segundo.jpg' };

export const PROVINCIAS: Record<string, string> = {
  C: 'A Coruña', VI: 'Álava', AB: 'Albacete', A: 'Alicante', AL: 'Almería', O: 'Asturias', AV: 'Ávila', BA: 'Badajoz',
  PM: 'Islas Baleares', B: 'Barcelona', BI: 'Vizcaya', BU: 'Burgos', CC: 'Cáceres', CA: 'Cádiz', S: 'Cantabria',
  CS: 'Castellón', CR: 'Ciudad Real', CO: 'Córdoba', CU: 'Cuenca', SS: 'Guipúzcoa', GI: 'Girona', GR: 'Granada',
  GU: 'Guadalajara', H: 'Huelva', HU: 'Huesca', J: 'Jaén', LO: 'La Rioja', GC: 'Las Palmas', LE: 'León', L: 'Lleida',
  LU: 'Lugo', M: 'Madrid', MA: 'Málaga', MU: 'Murcia', NA: 'Navarra', OR: 'Ourense', P: 'Palencia', PO: 'Pontevedra',
  SA: 'Salamanca', TF: 'Santa Cruz de Tenerife', SG: 'Segovia', SE: 'Sevilla', SO: 'Soria', T: 'Tarragona', TE: 'Teruel',
  TO: 'Toledo', V: 'Valencia', VA: 'Valladolid', ZA: 'Zamora', Z: 'Zaragoza',
};
export const PREMIOS: Record<string, string> = {
  diego_de_muros: 'Premio Diego de Muros',
  victor_verde: 'Premio Víctor Verde',
  colegial_de_honor: 'Colegial de honor',
};
export const CARGOS: Record<string, string> = { decano: 'Decano', consejero: 'Consejero' };

export const PAISES: Record<string, string> ={ ES: 'España', GB: 'Reino Unido', VE: 'Venezuela' };
