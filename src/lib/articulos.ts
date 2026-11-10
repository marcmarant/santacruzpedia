// Une cada artículo con el dato al que está vinculado y calcula sus categorías automáticas
import type { Datos } from './datos';
import type { Articulo } from './wiki';
import { PISOS, PROVINCIAS } from './formato';

/** el dato del colegio al que apunta el artículo (o null si es libre o el dato ya no existe) */
export function entidadDe(a: Articulo, d: Datos): any {
  switch (a.tipo) {
    case 'colegial': return a.colegial_id ? d.cols.get(a.colegial_id) : null;
    case 'curso': return a.curso_id ? d.cursos.get(a.curso_id) : null;
    case 'habitacion': return a.habitacion_id != null ? d.habs.get(a.habitacion_id) : null;
    case 'evento': return d.eventos.find(e => e.cursoid === a.evento_curso && e.nombre === a.evento_nombre) ?? null;
    case 'estudio': return a.estudio_id ? d.estudios.get(a.estudio_id) : null;
    case 'director': return a.director_id ? d.directores.get(a.director_id) : null;
    case 'localidad': return a.localidad ? (d.ubic.get(a.localidad) ?? { localidad: a.localidad, provincia: null, pais: null }) : null;
    case 'libro': return a.libro_id != null ? d.libroPorId.get(a.libro_id) : null;
    default: return null;
  }
}

/** categorías que salen de los datos (las manuales se escriben en el texto con [[Categoría:…]]) */
export function categoriasAutomaticas(a: Articulo, e: any, d: Datos): string[] {
  if (!e) return a.tipo === 'libre' && a.id === 'colegio-mayor-santa-cruz' ? ['Colegios mayores de España', 'Universidad de Valladolid'] : [];
  switch (a.tipo) {
    case 'colegial': {
      const prov = d.ubic.get(e.procedencia)?.provincia;
      const actual = e.estancias.at(-1)?.curso === d.actual;
      const estudios = [...new Set(e.estancias.map((x: any) => x.estudio).filter(Boolean))] as string[];
      const cargos = new Set<string>(e.cargos.map((x: any) => x.cargo));
      const premios = new Set<string>(e.premios.map((p: any) => p.tipo));
      return ['Colegiales', e.promo && `Promoción de ${e.promo}`, prov && `Personas de ${PROVINCIAS[prov]}`,
        actual ? 'Colegiales actuales' : 'Antiguos colegiales',
        ...estudios.map(x => `Estudiantes de ${d.estudios.get(x)?.nombre}`),
        cargos.has('decano') && 'Decanos del colegio', cargos.has('consejero') && 'Consejeros del colegio',
        premios.has('diego_de_muros') && 'Premios Diego de Muros', premios.has('victor_verde') && 'Premios Víctor Verde',
        premios.has('colegial_de_honor') && 'Colegiales de honor',
      ].filter(Boolean) as string[];
    }
    case 'curso': return ['Cursos'];
    case 'habitacion': return ['Habitaciones', PISOS[e.piso]].filter(Boolean);
    case 'evento': return ['Eventos', `Curso ${e.cursoid}`];
    case 'estudio': return ['Estudios'];
    case 'director': return ['Directores del Colegio Mayor Santa Cruz'];
    case 'localidad': return ['Localidades', e.provincia && `Provincia de ${PROVINCIAS[e.provincia]}`].filter(Boolean);
    case 'libro': return ['Libros de la biblioteca', e.genero].filter(Boolean);
    default: return [];
  }
}
