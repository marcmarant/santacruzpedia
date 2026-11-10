// Bloques automáticos ({{nombre}}) que se pueden usar en cada tipo de artículo
import type { TipoPremio } from './datos';

export const BLOQUES: Record<string, string[]> = {
  colegial: ['trayectoria', 'linaje', 'eventos', 'companeros'],
  curso: ['cargos_y_premios', 'eventos', 'novatos', 'colegiales_por_planta'],
  director: ['colegiales'],
  evento: ['otras_ediciones'],
  habitacion: ['historial_residentes', 'plano'],
  estudio: ['colegiales'],
  localidad: ['colegiales'],
  libro: ['otras_obras'],
  colegio: ['directores', 'cifras'],   // artículo «Colegio Mayor Santa Cruz»
  premio: ['galardonados'],            // Premio Diego de Muros, Premio Víctor Verde, Colegial de honor
  decano: ['decanos'],
  consejero: ['consejeros'],
  consejo: ['consejos'],
};

/** artículos libres que tienen ficha y bloques propios */
export const ARTICULOS_ESPECIALES: Record<string, { tipo: string; premio?: TipoPremio }> = {
  'colegio-mayor-santa-cruz': { tipo: 'colegio' },
  'premio-diego-de-muros': { tipo: 'premio', premio: 'diego_de_muros' },
  'premio-victor-verde': { tipo: 'premio', premio: 'victor_verde' },
  'colegial-de-honor': { tipo: 'premio', premio: 'colegial_de_honor' },
  'decano': { tipo: 'decano' },
  'consejero': { tipo: 'consejero' },
  'consejo': { tipo: 'consejo' },
};

/** artículo de cada premio y cargo, para enlazarlos */
export const ARTICULO_PREMIO: Record<TipoPremio, string> = {
  diego_de_muros: 'premio-diego-de-muros', victor_verde: 'premio-victor-verde', colegial_de_honor: 'colegial-de-honor',
};
export const ARTICULO_CARGO: Record<'decano' | 'consejero', string> = { decano: 'decano', consejero: 'consejero' };

/** tipo de bloques de un artículo (los artículos especiales tienen los suyos) */
export const tipoBloques = (a: { id: string; tipo: string }) => ARTICULOS_ESPECIALES[a.id]?.tipo ?? a.tipo;
