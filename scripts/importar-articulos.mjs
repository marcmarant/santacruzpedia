// Crea en wiki.articulo un artículo por cada página que la wiki generaba automáticamente,
// con una primera versión aprobada cuyo texto es el que antes se generaba (Markdown + [[enlaces]] + {{marcadores}}).
// Es repetible: solo crea los artículos que aún no existen (útil cuando se añadan colegiales nuevos).
//
//   node scripts/importar-articulos.mjs            -> aplica
//   node scripts/importar-articulos.mjs --prueba   -> lo hace todo y lo deshace al final (muestra ejemplos)
import pg from 'pg';

pg.types.setTypeParser(1082, v => v);
const PRUEBA = process.argv.includes('--prueba');
const AUTOR = 'Santacruzpedia (automático)';
const RESUMEN = 'Texto inicial generado automáticamente a partir de la base de datos';

const db = new pg.Client({
  host: process.env.PGHOST || '100.107.17.5', port: 5432,
  database: process.env.PGDATABASE || 'scdb',
  user: process.env.PGUSER || 'scadmin',
  password: process.env.PGPASSWORD || 'cmendoza$1483',
});

// ---------- utilidades ----------
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fecha = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} de ${MESES[m - 1]} de ${y}`; };
const plural = (n, s, p = s + 's') => `${n} ${n === 1 ? s : p}`;
const md = s => String(s ?? '').replace(/([\\*_[\]`])/g, '\\$1');          // escapa Markdown en datos
const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const PROV = { C: 'A Coruña', VI: 'Álava', AB: 'Albacete', A: 'Alicante', AL: 'Almería', O: 'Asturias', AV: 'Ávila', BA: 'Badajoz', PM: 'Islas Baleares', B: 'Barcelona', BI: 'Vizcaya', BU: 'Burgos', CC: 'Cáceres', CA: 'Cádiz', S: 'Cantabria', CS: 'Castellón', CR: 'Ciudad Real', CO: 'Córdoba', CU: 'Cuenca', SS: 'Guipúzcoa', GI: 'Girona', GR: 'Granada', GU: 'Guadalajara', H: 'Huelva', HU: 'Huesca', J: 'Jaén', LO: 'La Rioja', GC: 'Las Palmas', LE: 'León', L: 'Lleida', LU: 'Lugo', M: 'Madrid', MA: 'Málaga', MU: 'Murcia', NA: 'Navarra', OR: 'Ourense', P: 'Palencia', PO: 'Pontevedra', SA: 'Salamanca', TF: 'Santa Cruz de Tenerife', SG: 'Segovia', SE: 'Sevilla', SO: 'Soria', T: 'Tarragona', TE: 'Teruel', TO: 'Toledo', V: 'Valencia', VA: 'Valladolid', ZA: 'Zamora', Z: 'Zaragoza' };

await db.connect();
const q = async (sql, p) => (await db.query(sql, p)).rows;

// ---------- datos ----------
const consultas = [
  'select * from colegial order by id', 'select * from colegial_curso order by cursoid', 'select * from curso order by id',
  'select * from director', 'select * from estudio order by id', 'select * from evento order by cursoid, nombre',
  'select * from habitacion order by id', 'select * from libro_vista order by id', 'select * from ubicacion order by localidad',
  'select * from apodo', 'select id, titulo from wiki.articulo', 'select titulo from wiki.redireccion',
];
const resultados = [];
for (const sql of consultas) resultados.push(await q(sql));
const [colegiales, cc, cursos, directores, estudios, eventos, habitaciones, libros, ubicaciones, apodos, existentes, redirExist] = resultados;
const actual = cursos.at(-1).id;
const colById = new Map(colegiales.map(c => [c.id, { ...c, estancias: [], apodos: [] }]));
for (const r of cc) colById.get(r.colegialid)?.estancias.push(r);
for (const a of apodos) colById.get(a.colegialid)?.apodos.push(a.apodo);
const dirById = new Map(directores.map(d => [d.id, d]));
const estById = new Map(estudios.map(e => [e.id, e]));
const habById = new Map(habitaciones.map(h => [h.id, h]));
const ubiByLoc = new Map(ubicaciones.map(u => [u.localidad, u]));
const miembros = id => cc.filter(r => r.cursoid === id);

// ---------- 1. lista de artículos con id, tipo, vínculo y título deseado ----------
const arts = [];
const add = a => arts.push(a);
add({ id: 'colegio-mayor-santa-cruz', tipo: 'libre', titulo: 'Colegio Mayor Santa Cruz', vinculo: {} });
for (const c of colById.values()) add({ id: c.id, tipo: 'colegial', titulo: c.mote || c.id, vinculo: { colegial_id: c.id }, d: c, dis: c.promocion ? String(c.promocion) : 'colegial' });
for (const c of cursos) add({ id: `curso-${c.id}`, tipo: 'curso', titulo: `Curso ${c.id}`, vinculo: { curso_id: c.id }, d: c });
for (const h of habitaciones) add({ id: `habitacion-${h.id}`, tipo: 'habitacion', titulo: `Habitación ${h.id}`, vinculo: { habitacion_id: h.id }, d: h });
for (const e of eventos) add({ id: `evento-${e.cursoid}-${slug(e.nombre)}`, tipo: 'evento', titulo: `${e.nombre} (${e.cursoid})`, vinculo: { evento_curso: e.cursoid, evento_nombre: e.nombre }, d: e });
for (const e of estudios) add({ id: `estudio-${slug(e.id)}`, tipo: 'estudio', titulo: e.nombre, vinculo: { estudio_id: e.id }, d: e, dis: 'estudios' });
for (const d of directores) add({ id: `director-${slug(d.id)}`, tipo: 'director', titulo: d.nombre, vinculo: { director_id: d.id }, d, dis: 'director' });
for (const u of ubicaciones) add({ id: `localidad-${slug(u.localidad)}`, tipo: 'localidad', titulo: u.localidad, vinculo: { localidad: u.localidad }, d: u, dis: 'localidad' });
for (const l of libros) add({ id: `libro-${l.id}`, tipo: 'libro', titulo: l.titulo, vinculo: { libro_id: l.id }, d: l, dis: `libro nº ${l.id}` });

// ids: si alguno chocara (con otro nuevo o con uno ya existente) se le añade sufijo
const idsUsados = new Set(existentes.map(e => e.id));
const yaExiste = new Map(existentes.map(e => [e.id, e]));
for (const a of arts) if (yaExiste.has(a.id)) a.titulo = yaExiste.get(a.id).titulo;   // respeta el título actual
const nuevos = arts.filter(a => !yaExiste.has(a.id));
for (const a of nuevos) {
  let id = a.id, n = 2;
  while (idsUsados.has(id)) id = `${a.id}-${n++}`;
  if (id !== a.id) console.warn(`Aviso: id ${a.id} ya usado, se usa ${id}`);
  a.id = id; idsUsados.add(id);
}

// títulos: los repetidos se desambiguan con "(promoción)", "(estudios)", "(libro nº …)"…
const titulosExist = new Map(existentes.map(e => [e.titulo.toLowerCase(), e]));
const grupos = new Map();
for (const a of nuevos) { const k = a.titulo.toLowerCase(); (grupos.get(k) || grupos.set(k, []).get(k)).push(a); }
for (const [k, g] of grupos) if (g.length > 1 || titulosExist.has(k)) for (const a of g) a.titulo = `${a.titulo} (${a.dis || a.tipo})`;
const ocupados = new Set([...titulosExist.keys()]);
for (const a of nuevos) {
  let t = a.titulo, n = 2;
  while (ocupados.has(t.toLowerCase())) t = `${a.titulo} (${n++})`;
  a.titulo = t; ocupados.add(t.toLowerCase());
}

// mapa para generar enlaces: (tipo, clave) -> título
const tituloDe = new Map(arts.map(a => [`${a.tipo}:${a.vinculo && Object.values(a.vinculo).join('|')}`, a.titulo]));
for (const e of existentes) tituloDe.set(`id:${e.id}`, e.titulo);
const T = (tipo, clave) => tituloDe.get(`${tipo}:${clave}`);
const L = (tipo, clave, texto) => {
  const t = T(tipo, clave);
  if (!t || /[[\]|]/.test(t)) return md(texto ?? clave);
  return texto && texto !== t ? `[[${t}|${md(texto)}]]` : `[[${t}]]`;
};
const CM = '[[Colegio Mayor Santa Cruz]]';

// ---------- 2. textos (los mismos que generaba la wiki) ----------
const texto = {
  libre() {
    const n = miembros(actual).length;
    return `El **Colegio Mayor Santa Cruz** es un colegio mayor de Valladolid heredero del histórico colegio fundado en el siglo XV por el **cardenal Pedro González de Mendoza**. Su sede **Cardenal Mendoza**, conocida entre sus residentes como *la buena*, alberga a ${plural(n, 'colegial', 'colegiales')} en el curso ${L('curso', actual)}, distribuidos en ${habitaciones.length} habitaciones repartidas en tres plantas: [Post](/habitaciones#p0), el [primer piso](/habitaciones#p1) y el [segundo piso](/habitaciones#p2).

## Vida colegial

Cada colegial recibe a su llegada un **mote**, por el que es conocido durante toda su estancia (e incluso después), y es apadrinado por un colegial veterano, su **padrino**. Las relaciones entre padrinos y ahijados forman auténticos linajes, recogidos en el [árbol de padrinos](/arbol).

A lo largo del curso se celebran numerosos [eventos](/eventos): la Fiesta de Pisos, las capeas de cada cuatrimestre, la fiesta de imposición de insignias, la fiesta del colegio y viajes y rutas por la geografía española y portuguesa.

{{directores}}

{{cifras}}

## Véase también

- [Lista de colegiales](/colegiales)
- [Habitaciones](/habitaciones)
- [Servidor del Mayor](http://100.107.17.5/)`;
  },
  colegial(c) {
    const ult = c.estancias.at(-1);
    const esActual = ult?.cursoid === actual;
    const u = ubiByLoc.get(c.procedencia);
    const ests = [...new Set(c.estancias.map(e => e.estudio).filter(Boolean))];
    const paren = [c.procedencia && L('localidad', c.procedencia), c.nacimiento && fecha(c.nacimiento)].filter(Boolean).join(', ');
    let t = `**${md(c.nombre || c.mote)}**${paren ? ` (${paren})` : ''}, conocido en el colegio como **«${md(c.mote)}»**`;
    if (c.apodos.length) t += ` o también ${c.apodos.map(a => `**«${md(a)}»**`).join(', ')}`;
    t += `, ${esActual ? 'es' : 'fue'} colegial del ${CM}${c.promocion ? ` perteneciente a la promoción de ${c.promocion}` : ''}.`;
    if (ests.length) t += ` ${esActual ? 'Estudia' : 'Estudió'} ${ests.map(e => L('estudio', e, estById.get(e)?.nombre)).join(' y ')}.`;
    if (c.pid && colById.has(c.pid)) t += ` Fue apadrinado por ${L('colegial', c.pid, colById.get(c.pid).mote)}.`;
    void u;
    return `${t}\n\n{{trayectoria}}\n\n{{linaje}}\n\n{{eventos}}\n\n{{companeros}}`;
  },
  curso(c) {
    const ms = miembros(c.id);
    const novatos = ms.filter(m => colById.get(m.colegialid)?.estancias[0]?.cursoid === c.id).length;
    const dir = dirById.get(c.directorid);
    return `El **curso ${c.id}** ${c.id === actual ? 'es el curso actual' : 'fue un curso académico'} del ${CM}${dir ? `, bajo la dirección de ${L('director', dir.id, dir.nombre)}` : ''}. ${plural(ms.length, 'colegial', 'colegiales')} ${ms.length === 1 ? 'residió' : 'residieron'} en el colegio${novatos ? `, ${novatos} de ellos novatos` : ''}.

{{eventos}}

{{novatos}}

{{colegiales_por_planta}}`;
  },
  director(d) {
    const cs = cursos.filter(c => c.directorid === d.id);
    const n = new Set(cc.filter(r => cs.some(c => c.id === r.cursoid)).map(r => r.colegialid)).size;
    return `**${md(d.nombre)}** ${cs.at(-1)?.id === actual ? 'es el actual director' : 'fue director'} del ${CM}${cs.length === 1 ? ` durante el ${L('curso', cs[0].id, `curso ${cs[0].id}`)}` : cs.length ? ` durante ${plural(cs.length, 'curso')} (${L('curso', cs[0].id)} – ${L('curso', cs.at(-1).id)})` : ''}, periodo en el que pasaron por el colegio ${plural(n, 'colegial', 'colegiales')}.

{{colegiales}}`;
  },
  evento(e) {
    let t = `La **${md(e.nombre)}** fue un evento celebrado durante el curso ${L('curso', e.cursoid)} en el ${CM}.`;
    if (e.info) {
      // enlaza la primera mención de cada colegial de ese curso (por su mote)
      const cols = miembros(e.cursoid).map(m => colById.get(m.colegialid)).filter(c => c && (c.mote || '').length > 3)
        .sort((a, b) => b.mote.length - a.mote.length);
      let info = md(e.info);
      const fichas = [];
      for (const c of cols) {
        const re = new RegExp(`(^|[^\\p{L}])(${md(c.mote).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}])`, 'u');
        info = info.replace(re, (_, pre, m) => { fichas.push(L('colegial', c.id, m)); return `${pre}\u0000${fichas.length - 1}\u0000`; });
      }
      info = info.replace(/\u0000(\d+)\u0000/g, (_, i) => fichas[i]);
      info = info.replace(/\r/g, '').replace(/(\p{Ll})\n(\p{Ll})/gu, '$1$2');   // salto que partía una palabra
      t += `\n\n## Crónica\n\n${info.replace(/\n+/g, '\n\n')}`;
    }
    return `${t}\n\n{{otras_ediciones}}`;
  },
  habitacion(h) {
    const planta = { 0: 'de Post (planta baja)', 1: 'del primer piso', 2: 'del segundo piso' }[h.piso] || 'de una planta desconocida';
    return `La **habitación ${h.id}** es una de las habitaciones ${planta} del ${CM}.${h.descripcion ? `\n\n## Descripción\n\n${md(h.descripcion)}` : ''}

{{historial_residentes}}

{{plano}}`;
  },
  estudio(e) {
    const n = new Set(cc.filter(r => r.estudio === e.id).map(r => r.colegialid)).size;
    return `**${md(e.nombre)}** (${e.tipo}) es la titulación cursada por ${plural(n, 'colegial', 'colegiales')} del ${CM}.

{{colegiales}}`;
  },
  localidad(u) {
    const n = colegiales.filter(c => c.procedencia === u.localidad).length;
    return `**${md(u.localidad)}**${u.provincia ? ` (provincia de ${PROV[u.provincia] || u.provincia})` : ''} es la localidad de procedencia de ${plural(n, 'colegial', 'colegiales')} del ${CM}.

{{colegiales}}`;
  },
  libro(l) {
    return `***${md(l.titulo)}***${l.autor ? ` es una obra de ${md(l.autor)}` : ' es una obra'}${l.fecha ? ` publicada en ${l.fecha}` : ''}${l.editorial ? ` por ${md(l.editorial)}` : ''}. Un ejemplar se conserva en la [biblioteca del colegio](/biblioteca)${l.localizacion ? `, en la estantería ${md(l.localizacion)}` : ''}.

{{otras_obras}}`;
  },
};
for (const a of nuevos) a.contenido = texto[a.tipo](a.d);

// ---------- 3. redirecciones: apodos y nombres completos de colegiales ----------
const titulosFinal = new Set([...existentes.map(e => e.titulo.toLowerCase()), ...nuevos.map(a => a.titulo.toLowerCase())]);
const redirUsadas = new Set(redirExist.map(r => r.titulo.toLowerCase()));
const nombresRep = new Set(colegiales.map(c => c.nombre?.toLowerCase()).filter((n, i, all) => n && all.indexOf(n) !== i));
const redirs = [];
const addRedir = (titulo, articulo_id, origen) => {
  const k = titulo?.trim().toLowerCase();
  if (!k || titulosFinal.has(k) || redirUsadas.has(k)) return;
  redirUsadas.add(k); redirs.push({ titulo: titulo.trim(), articulo_id, origen });
};
for (const a of nuevos.filter(a => a.tipo === 'colegial')) {
  for (const ap of a.d.apodos) addRedir(ap, a.id, 'apodo');
  if (a.d.nombre && !nombresRep.has(a.d.nombre.toLowerCase())) addRedir(a.d.nombre, a.id, 'nombre');
}

// ---------- 4. enlaces de cada texto ----------
const idPorTitulo = new Map([...existentes.map(e => [e.titulo.toLowerCase(), e.id]), ...nuevos.map(a => [a.titulo.toLowerCase(), a.id])]);
for (const r of [...redirs, ...(await q('select titulo, articulo_id from wiki.redireccion'))]) idPorTitulo.set(r.titulo.toLowerCase(), r.articulo_id);
const enlaces = [];
for (const a of nuevos) {
  const vistos = new Set();
  for (const [, t] of a.contenido.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const titulo = t.trim();
    if (/^categor[ií]a:/i.test(titulo) || vistos.has(titulo)) continue;
    vistos.add(titulo);
    enlaces.push({ origen_id: a.id, destino_titulo: titulo, destino_id: idPorTitulo.get(titulo.toLowerCase()) ?? null });
  }
}

// ---------- 5. guardar ----------
await db.query('begin');
try {
  const json = x => JSON.stringify(x);
  await db.query(`insert into wiki.articulo (id, titulo, tipo, colegial_id, curso_id, habitacion_id, evento_curso, evento_nombre, estudio_id, director_id, localidad, libro_id)
    select * from json_to_recordset($1) as x(id varchar, titulo varchar, tipo varchar, colegial_id varchar, curso_id varchar, habitacion_id int,
      evento_curso varchar, evento_nombre varchar, estudio_id varchar, director_id varchar, localidad varchar, libro_id int)`,
  [json(nuevos.map(a => ({ id: a.id, titulo: a.titulo, tipo: a.tipo, ...a.vinculo })))]);
  const revs = await q(`insert into wiki.revision (articulo_id, contenido, resumen, autor, estado, fecha_revision)
    select articulo_id, contenido, $2, $3, 'aprobada', now() from json_to_recordset($1) as x(articulo_id varchar, contenido text)
    returning id, articulo_id`, [json(nuevos.map(a => ({ articulo_id: a.id, contenido: a.contenido }))), RESUMEN, AUTOR]);
  await db.query(`update wiki.articulo a set revision_actual = x.id from json_to_recordset($1) as x(id int, articulo_id varchar) where a.id = x.articulo_id`, [json(revs)]);
  await db.query(`insert into wiki.redireccion (titulo, articulo_id, origen) select * from json_to_recordset($1) as x(titulo varchar, articulo_id varchar, origen varchar)`, [json(redirs)]);
  await db.query(`insert into wiki.enlace (origen_id, destino_titulo, destino_id) select * from json_to_recordset($1) as x(origen_id varchar, destino_titulo varchar, destino_id varchar)`, [json(enlaces)]);
  await db.query(`insert into wiki.registro (accion, articulo_id, revision_id, usuario, detalle)
    select 'importar', articulo_id, id, $2, $3 from json_to_recordset($1) as x(id int, articulo_id varchar)`, [json(revs), AUTOR, RESUMEN]);

  const porTipo = {}; for (const a of nuevos) porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1;
  console.log('Artículos creados:', nuevos.length, porTipo);
  console.log('Redirecciones:', redirs.length, '· Enlaces:', enlaces.length, '(rojos:', enlaces.filter(e => !e.destino_id).length + ')');
  const renombrados = nuevos.filter(a => /\(.+\)$/.test(a.titulo) && a.tipo !== 'evento');
  if (renombrados.length) console.log('Títulos desambiguados:', renombrados.length, renombrados.slice(0, 8).map(a => a.titulo));
  if (PRUEBA) {
    for (const id of ['2021plato', 'curso-2024-2025', 'evento-2024-2025-ruta-laguna-negra', 'habitacion-21']) {
      const a = nuevos.find(x => x.id === id);
      if (a) console.log(`\n===== ${a.id} · «${a.titulo}» =====\n${a.contenido}`);
    }
    await db.query('rollback');
    console.log('\n(PRUEBA: todo deshecho, no se ha guardado nada)');
  } else {
    await db.query('commit');
    console.log('Guardado.');
  }
} catch (e) {
  await db.query('rollback');
  console.error('ERROR, no se ha guardado nada:', e.message);
  process.exitCode = 1;
}
await db.end();
