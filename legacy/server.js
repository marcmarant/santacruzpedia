// Santacruzpedia — wiki local del Colegio Mayor Santa Cruz (Sede Cardenal Mendoza)
import express from 'express';
import pg from 'pg';

pg.types.setTypeParser(1082, v => v); // fechas como texto YYYY-MM-DD

const PORT = process.env.PORT || 8090;
const REMOTE = 'http://100.107.17.5';
const pool = new pg.Pool({
  host: process.env.PGHOST || '100.107.17.5',
  port: 5432,
  database: process.env.PGDATABASE || 'scdb',
  user: process.env.PGUSER || 'scadmin',
  password: process.env.PGPASSWORD || 'cmendoza$1483',
  max: 3,
});

// ---------- utilidades ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fix = s => s == null || s === 'NaN' ? null : String(s).replace(/£/g, 'ú').replace(/(\p{L}) (\p{L})/gu, '$1á$2').trim();
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fecha = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${+dd} de ${MESES[m - 1]} de ${y}`; };
const edad = d => { const n = new Date(d), h = new Date(); let a = h.getFullYear() - n.getFullYear(); if (h < new Date(h.getFullYear(), n.getMonth(), n.getDate())) a--; return a; };
const PISOS = { 0: 'Post (planta baja)', 1: 'Primer piso', 2: 'Segundo piso' };
const PLANO = { 0: 'plano-post.jpg', 1: 'plano-primero.jpg', 2: 'plano-segundo.jpg' };
const PROV = { C: 'A Coruña', VI: 'Álava', AB: 'Albacete', A: 'Alicante', AL: 'Almería', O: 'Asturias', AV: 'Ávila', BA: 'Badajoz', PM: 'Islas Baleares', B: 'Barcelona', BI: 'Vizcaya', BU: 'Burgos', CC: 'Cáceres', CA: 'Cádiz', S: 'Cantabria', CS: 'Castellón', CR: 'Ciudad Real', CO: 'Córdoba', CU: 'Cuenca', SS: 'Guipúzcoa', GI: 'Girona', GR: 'Granada', GU: 'Guadalajara', H: 'Huelva', HU: 'Huesca', J: 'Jaén', LO: 'La Rioja', GC: 'Las Palmas', LE: 'León', L: 'Lleida', LU: 'Lugo', M: 'Madrid', MA: 'Málaga', MU: 'Murcia', NA: 'Navarra', OR: 'Ourense', P: 'Palencia', PO: 'Pontevedra', SA: 'Salamanca', TF: 'Santa Cruz de Tenerife', SG: 'Segovia', SE: 'Sevilla', SO: 'Soria', T: 'Tarragona', TE: 'Teruel', TO: 'Toledo', V: 'Valencia', VA: 'Valladolid', ZA: 'Zamora', Z: 'Zaragoza' };
const PAIS = { ES: 'España', GB: 'Reino Unido', UK: 'Reino Unido', VE: 'Venezuela' };
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ---------- datos en memoria ----------
let D = null;
const fotos = new Map(); // id -> Buffer | null

async function cargar() {
  const q = async t => (await pool.query(`select * from ${t}`)).rows;
  const [colegial, cc, curso, director, estudio, evento, habitacion, libro, ubicacion, apodo] =
    await Promise.all(['colegial', 'colegial_curso', 'curso', 'director', 'estudio', 'evento', 'habitacion', 'libro_vista', 'ubicacion', 'apodo'].map(q));
  const d = {};
  d.estudios = new Map(estudio.map(e => [e.id, { ...e, nombre: fix(e.nombre) }]));
  d.directores = new Map(director.map(x => [x.id, x]));
  d.ubic = new Map(ubicacion.map(u => [u.localidad, { ...u, pais: u.pais?.trim() || (u.provincia ? 'ES' : null) }]));
  d.habs = new Map(habitacion.sort((a, b) => a.id - b.id).map(h => [h.id, { ...h, historial: [] }]));
  d.cursos = new Map(curso.sort((a, b) => a.id.localeCompare(b.id)).map(c => [c.id, { ...c, director: d.directores.get(c.directorid), miembros: [], eventos: [] }]));
  d.actual = [...d.cursos.keys()].at(-1);
  d.cols = new Map(colegial.map(c => [c.id, {
    ...c, nombre: fix(c.nombre) || null, mote: fix(c.mote) || c.id,
    promo: c.promocion ?? null, apodos: [], estancias: [], ahijados: [],
  }]));
  for (const a of apodo) d.cols.get(a.colegialid)?.apodos.push(a.apodo);
  for (const c of d.cols.values()) if (c.pid && d.cols.has(c.pid)) d.cols.get(c.pid).ahijados.push(c);
  for (const r of cc.sort((a, b) => a.cursoid.localeCompare(b.cursoid))) {
    const c = d.cols.get(r.colegialid), cu = d.cursos.get(r.cursoid); if (!c || !cu) continue;
    const e = { curso: r.cursoid, hab: r.habitacion, estudio: r.estudio, col: c };
    c.estancias.push(e); cu.miembros.push(e);
    if (r.habitacion && d.habs.has(r.habitacion)) d.habs.get(r.habitacion).historial.push(e);
  }
  d.eventos = evento.map(e => ({ ...e, info: fix(e.info) }));
  for (const e of d.eventos) d.cursos.get(e.cursoid)?.eventos.push(e);
  d.libros = libro.sort((a, b) => a.id - b.id).map(l => ({
    ...l, titulo: fix(l.titulo), autor: fix(l.autor), genero: fix(l.genero), editorial: fix(l.editorial),
    observaciones: l.observaciones && l.observaciones !== 'NaN' ? fix(l.observaciones) : null,
    localizacion: l.localizacion && l.localizacion !== '--' ? l.localizacion : null,
  }));
  d.cargado = new Date();
  D = d;
  console.log(`Datos cargados: ${d.cols.size} colegiales, ${d.cursos.size} cursos, ${d.libros.length} libros`);
}

async function foto(id) {
  if (fotos.has(id)) return fotos.get(id);
  let buf = null;
  try {
    const r = await fetch(`${REMOTE}/assets/cmusantacruz/profile_photos/${encodeURIComponent(id)}.jpg`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) buf = Buffer.from(await r.arrayBuffer());
  } catch { return null; }
  fotos.set(id, buf);
  return buf;
}
const tieneFoto = id => fotos.get(id) != null;

// ---------- enlaces ----------
const L = {
  col: c => c ? `<a href="/colegial/${encodeURIComponent(c.id)}">${esc(c.mote)}</a>` : '',
  colId: id => D.cols.has(id) ? L.col(D.cols.get(id)) : `<a class="new" title="La página no existe">${esc(id)}</a>`,
  curso: id => `<a href="/curso/${id}">${esc(id)}</a>`,
  hab: n => n ? `<a href="/habitacion/${n}">Habitación ${n}</a>` : '—',
  est: id => id && D.estudios.has(id) ? `<a href="/estudio/${id}">${esc(D.estudios.get(id).nombre)}</a>` : '—',
  loc: l => l ? `<a href="/procedencia/${encodeURIComponent(l)}">${esc(l)}</a>` : '',
  dir: d => d ? `<a href="/director/${d.id}">${esc(d.nombre)}</a>` : '<i>Sin datos</i>',
  ev: e => `<a href="/evento/${e.cursoid}/${encodeURIComponent(e.nombre)}">${esc(e.nombre)}</a>`,
  libro: l => `<a href="/libro/${l.id}">${esc(l.titulo)}</a>`,
};
const img = (c, cls = '') => `<img class="${cls}" loading="lazy" src="/foto/${encodeURIComponent(c.id)}" alt="${esc(c.mote)}">`;
const tarjeta = (c, extra = '') => `<div class="gal"><a href="/colegial/${encodeURIComponent(c.id)}">${img(c)}</a><div>${L.col(c)}${extra ? `<br><small>${extra}</small>` : ''}</div></div>`;
const galeria = (arr, extra) => `<div class="gallery">${arr.map(x => tarjeta(x, extra?.(x))).join('')}</div>`;
const infobox = (titulo, imagen, filas, pie = '') => `<table class="infobox"><tr><th colspan="2" class="ib-title">${titulo}</th></tr>
  ${imagen ? `<tr><td colspan="2" class="ib-img">${imagen}${pie ? `<div class="ib-cap">${pie}</div>` : ''}</td></tr>` : ''}
  ${filas.filter(f => f && (f.length === 1 || (f[1] !== null && f[1] !== undefined && f[1] !== ''))).map(f => f.length === 1 ? `<tr><th colspan="2" class="ib-sec">${f[0]}</th></tr>` : `<tr><th>${f[0]}</th><td>${f[1]}</td></tr>`).join('')}</table>`;
const tabla = (cab, filas, cls = 'wikitable sortable') => `<table class="${cls}"><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.map(f => `<tr>${f.map(c => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const plural = (n, s, p = s + 's') => `${n} ${n === 1 ? s : p}`;

// ---------- plantilla ----------
function pagina(res, { titulo, sub = '', cuerpo, cats = [], status = 200 }) {
  let toc = [];
  let i = 0;
  cuerpo = cuerpo.replace(/<h2>(.*?)<\/h2>/g, (_, t) => { const id = 's' + (++i); toc.push([id, t.replace(/<[^>]+>/g, '')]); return `<h2 id="${id}">${t}</h2>`; });
  res.status(status).send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} - Santacruzpedia</title><link rel="icon" href="/logo.png"><link rel="stylesheet" href="/wiki.css"></head><body>
<header class="top"><a class="brand" href="/"><img src="/logo.png" alt=""><span><b>Santacruzpedia</b><small>La enciclopedia del Mayor</small></span></a>
<form class="search" action="/buscar"><input name="q" placeholder="Buscar en Santacruzpedia" autocomplete="off"><button>Buscar</button></form>
<button class="theme" onclick="document.documentElement.classList.toggle('dark');localStorage.dark=document.documentElement.classList.contains('dark')?1:''" title="Modo oscuro">◐</button></header>
<script>if(localStorage.dark)document.documentElement.classList.add('dark')</script>
<div class="wrap"><nav class="side">
<h4>Navegación</h4><a href="/">Portada</a><a href="/wiki/Colegio_Mayor_Santa_Cruz">El Colegio Mayor</a><a href="/aleatorio">Página aleatoria</a>
<h4>Explorar</h4><a href="/colegiales">Colegiales</a><a href="/cursos">Cursos</a><a href="/eventos">Eventos</a><a href="/habitaciones">Habitaciones</a><a href="/arbol">Árbol de padrinos</a><a href="/estudios">Estudios</a><a href="/procedencias">Procedencias</a><a href="/biblioteca">Biblioteca</a>
${toc.length > 2 ? `<h4>Contenidos</h4><a href="#top">(Inicio)</a>${toc.map(([id, t]) => `<a class="toc" href="#${id}">${esc(t)}</a>`).join('')}` : ''}
</nav><main id="top"><div class="tabs"><span class="sel">Artículo</span><span class="r">Leer</span></div>
<h1>${titulo}</h1><div class="sitesub">De Santacruzpedia, la enciclopedia libre del Colegio Mayor Santa Cruz${sub ? ` · ${sub}` : ''}</div>
<div class="content">${cuerpo}</div>
${cats.length ? `<div class="catlinks"><b>Categorías:</b> ${cats.map(c => `<span>${c}</span>`).join(' | ')}</div>` : ''}
<footer>Datos obtenidos de la base de datos <code>scdb</code> el ${D.cargado.toLocaleString('es-ES')}. El texto está disponible bajo la licencia «Lo que pasa en el Mayor se queda en el Mayor».</footer>
</main></div>
<script>document.querySelectorAll('table.sortable th').forEach((th,i)=>th.onclick=()=>{const tb=th.closest('table').tBodies[0],r=[...tb.rows],asc=th.dataset.o!=='a';th.dataset.o=asc?'a':'d';const v=x=>{const t=x.cells[i]?.innerText.trim()||'';const n=parseFloat(t.replace(',','.'));return isNaN(n)||!/^[\\d.,-]+/.test(t)?t.toLowerCase():n};r.sort((a,b)=>{const x=v(a),y=v(b);return (x>y?1:x<y?-1:0)*(asc?1:-1)});r.forEach(x=>tb.appendChild(x))});
document.querySelectorAll('input[data-filtro]').forEach(inp=>inp.oninput=()=>{const q=inp.value.toLowerCase();document.querySelectorAll(inp.dataset.filtro).forEach(el=>el.style.display=el.innerText.toLowerCase().includes(q)?'':'none')})</script>
</body></html>`);
}
const noExiste = (res, que) => pagina(res, { titulo: 'Página no encontrada', status: 404, cuerpo: `<div class="ambox">Santacruzpedia aún no tiene ningún artículo sobre <b>${esc(que)}</b>. Prueba a <a href="/buscar?q=${encodeURIComponent(que)}">buscarlo</a>.</div>` });

// ---------- servidor ----------
const app = express();
app.use(express.static('public', { maxAge: '1h' }));
app.use((req, res, next) => D ? next() : res.status(503).send('Cargando datos de la base de datos… recarga en unos segundos.'));

const SILUETA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 380"><rect width="300" height="380" fill="#eaecf0"/><circle cx="150" cy="140" r="70" fill="#a2a9b1"/><path d="M30 380c0-80 55-140 120-140s120 60 120 140z" fill="#a2a9b1"/></svg>`;
app.get('/foto/:id', async (req, res) => {
  const b = await foto(req.params.id);
  res.set('Cache-Control', 'public, max-age=86400');
  if (b) res.type('jpg').send(b); else res.type('svg').send(SILUETA);
});
app.get('/plano/:piso', async (req, res) => {
  const f = PLANO[req.params.piso]; if (!f) return res.sendStatus(404);
  res.redirect(`${REMOTE}/habitaciones/assets/${f}`);
});

// Portada
app.get('/', (req, res) => {
  const cu = D.cursos.get(D.actual);
  const conFoto = [...D.cols.values()].filter(c => tieneFoto(c.id));
  const dia = Math.floor(Date.now() / 864e5);
  const dest = conFoto.length ? conFoto[dia % conFoto.length] : [...D.cols.values()][dia % D.cols.size];
  const provs = {}; for (const c of D.cols.values()) { const p = D.ubic.get(c.procedencia)?.provincia; if (p) provs[p] = (provs[p] || 0) + 1; }
  const topProv = Object.entries(provs).sort((a, b) => b[1] - a[1])[0];
  const padrinoTop = [...D.cols.values()].sort((a, b) => b.ahijados.length - a.ahijados.length)[0];
  const hab = [...D.habs.values()].sort((a, b) => b.historial.length - a.historial.length)[0];
  const libro = D.libros[dia % D.libros.length];
  const antiguo = D.libros.filter(l => l.fecha).sort((a, b) => a.fecha - b.fecha)[0];
  pagina(res, {
    titulo: 'Portada', cuerpo: `
<div class="welcome"><h2 class="nob">Bienvenidos a Santacruzpedia,</h2><p>la enciclopedia libre del <a href="/wiki/Colegio_Mayor_Santa_Cruz">Colegio Mayor Santa Cruz</a> de Valladolid, sede Cardenal Mendoza <i>(la buena)</i>.<br>
<b>${D.cols.size}</b> colegiales · <b>${D.cursos.size}</b> cursos · <b>${D.habs.size}</b> habitaciones · <b>${D.libros.length}</b> libros</p></div>
<div class="mp"><div class="box"><h3>Colegial destacado</h3>${dest ? `<a href="/colegial/${dest.id}" class="fr">${img(dest, 'feat')}</a><p><b>${L.col(dest)}</b>${dest.nombre ? ` (${esc(dest.nombre)})` : ''} es colegial${dest.promo ? ` de la promoción de ${dest.promo}` : ''}${dest.procedencia ? `, natural de ${L.loc(dest.procedencia)}` : ''}. ${dest.estancias.length ? `Ha vivido ${plural(dest.estancias.length, 'curso')} en el colegio${dest.estancias.at(-1).hab ? `, el último en la ${L.hab(dest.estancias.at(-1).hab)}` : ''}.` : ''} ${dest.pid ? `Su padrino es ${L.colId(dest.pid)}.` : ''} ${dest.ahijados.length ? `Tiene ${plural(dest.ahijados.length, 'ahijado')}.` : ''}</p><p><a href="/colegial/${dest.id}">Leer más…</a></p>` : ''}</div>
<div class="box"><h3>¿Sabías que…?</h3><ul>
<li>…que ${topProv ? `la provincia de <b>${PROV[topProv[0]]}</b> es la que más colegiales ha aportado (${topProv[1]})?` : ''}</li>
<li>…que ${L.col(padrinoTop)} es el padrino más prolífico, con ${plural(padrinoTop.ahijados.length, 'ahijado')}?</li>
<li>…que por la ${L.hab(hab.id)} han pasado ${hab.historial.length} residentes?</li>
${antiguo ? `<li>…que el libro más antiguo de la <a href="/biblioteca">biblioteca</a> es ${L.libro(antiguo)}, de ${antiguo.fecha}?</li>` : ''}
<li>…que hay ${[...D.cols.values()].filter(c => c.apodos.length).length} colegiales con más de un apodo?</li></ul></div></div>
<div class="box"><h3>Actualidad: curso ${L.curso(D.actual)}</h3><p>Director: ${L.dir(cu.director)} · ${plural(cu.miembros.length, 'colegial', 'colegiales')} · Novatos: ${cu.miembros.filter(m => m.col.estancias[0].curso === D.actual).length}</p>
${galeria(cu.miembros.map(m => m.col).sort((a, b) => a.mote.localeCompare(b.mote)))}</div>
<div class="mp"><div class="box"><h3>Libro del día</h3><p>${L.libro(libro)}${libro.autor ? `, de ${esc(libro.autor)}` : ''}${libro.fecha ? ` (${libro.fecha})` : ''}.</p></div>
<div class="box"><h3>Cursos</h3><p>${[...D.cursos.keys()].map(L.curso).join(' · ')}</p></div></div>`,
  });
});

// Artículo del colegio
app.get('/wiki/Colegio_Mayor_Santa_Cruz', (req, res) => {
  const cu = D.cursos.get(D.actual);
  const dirs = [...D.directores.values()].map(d => { const cs = [...D.cursos.values()].filter(c => c.directorid === d.id).map(c => c.id); return [d, cs]; }).sort((a, b) => (a[1][0] || '').localeCompare(b[1][0] || ''));
  pagina(res, {
    titulo: 'Colegio Mayor Santa Cruz (sede Cardenal Mendoza)', cats: ['Colegios mayores de España', 'Universidad de Valladolid'],
    cuerpo: infobox('Colegio Mayor Santa Cruz', `<img src="/logo.png" style="width:180px">`, [
      ['Sede', 'Cardenal Mendoza (masculina)'], ['Ciudad', 'Valladolid, España'], ['Fundador histórico', 'Cardenal Pedro González de Mendoza'],
      ['Director', L.dir(cu.director)], ['Curso actual', L.curso(D.actual)], ['Colegiales', cu.miembros.length], ['Habitaciones', `${D.habs.size} en 3 plantas`],
      ['Libros en biblioteca', D.libros.length], ['Apodo', '«El bueno»'],
    ], 'Sello del colegio') + `
<p>El <b>Colegio Mayor Santa Cruz</b> es un colegio mayor de Valladolid heredero del histórico colegio fundado en el siglo XV por el <b>cardenal Pedro González de Mendoza</b>. Su sede <b>Cardenal Mendoza</b>, conocida entre sus residentes como <i>la buena</i>, alberga a ${plural(cu.miembros.length, 'colegial', 'colegiales')} en el curso ${L.curso(D.actual)}, distribuidos en ${D.habs.size} habitaciones repartidas en tres plantas: <a href="/habitaciones#p0">Post</a>, el <a href="/habitaciones#p1">primer piso</a> y el <a href="/habitaciones#p2">segundo piso</a>.</p>
<h2>Vida colegial</h2><p>Cada colegial recibe a su llegada un <b>mote</b>, por el que es conocido durante toda su estancia (e incluso después), y es apadrinado por un colegial veterano, su <b>padrino</b>. Las relaciones entre padrinos y ahijados forman auténticos linajes, recogidos en el <a href="/arbol">árbol de padrinos</a>.</p>
<p>A lo largo del curso se celebran numerosos <a href="/eventos">eventos</a>: la Fiesta de Pisos, las capeas de cada cuatrimestre, la fiesta de imposición de insignias, la fiesta del colegio y viajes y rutas por la geografía española y portuguesa.</p>
<h2>Directores</h2>${tabla(['Director', 'Cursos'], dirs.map(([d, cs]) => [L.dir(d), cs.length ? `${cs[0]} – ${cs.at(-1)}` : '']), 'wikitable')}
<h2>Cifras</h2><ul><li>${D.cols.size} colegiales registrados.</li><li>${D.cursos.size} cursos documentados (${[...D.cursos.keys()][0]} – ${D.actual}).</li><li>${D.eventos.length} eventos registrados.</li><li>Una biblioteca de ${D.libros.length} volúmenes.</li></ul>
<h2>Véase también</h2><ul><li><a href="/colegiales">Lista de colegiales</a></li><li><a href="/habitaciones">Habitaciones</a></li><li><a href="${REMOTE}/">Servidor del Mayor</a></li></ul>`,
  });
});

// Colegial
app.get('/colegial/:id', (req, res) => {
  const c = D.cols.get(req.params.id); if (!c) return noExiste(res, req.params.id);
  const u = D.ubic.get(c.procedencia);
  const padrino = D.cols.get(c.pid);
  const linaje = []; let p = padrino; const vistos = new Set();
  while (p && !vistos.has(p.id)) { vistos.add(p.id); linaje.unshift(p); p = D.cols.get(p.pid); }
  const ult = c.estancias.at(-1);
  const actual = ult?.curso === D.actual;
  const estudios = [...new Set(c.estancias.map(e => e.estudio).filter(Boolean))];
  const companeros = [...D.cols.values()].filter(x => c.promo != null && x.promo === c.promo && x.id !== c.id);
  const homonimos = [...D.cols.values()].filter(x => x.id !== c.id && norm(x.mote) === norm(c.mote));
  const lugar = c.procedencia ? `${L.loc(c.procedencia)}${u?.provincia ? `, ${PROV[u.provincia]}` : ''}${u?.pais && u.pais !== 'ES' ? `, ${PAIS[u.pais] || u.pais}` : ''}` : '';
  const stub = !c.nombre || !c.procedencia || !c.estancias.length;
  const cats = ['Colegiales', c.promo && `Promoción de ${c.promo}`, u?.provincia && `Personas de ${PROV[u.provincia]}`, actual ? 'Colegiales actuales' : 'Antiguos colegiales', ...estudios.map(e => `Estudiantes de ${D.estudios.get(e)?.nombre}`)].filter(Boolean);
  pagina(res, {
    titulo: esc(c.mote), sub: c.nombre ? esc(c.nombre) : '', cats,
    cuerpo: `${homonimos.length ? `<div class="hatnote">Este artículo trata sobre el colegial ${c.promo ? `de ${c.promo}` : `de promoción desconocida`}. Para otros colegiales con el mismo mote, véase ${homonimos.map(h => `${L.col(h)} (${h.promo ?? 'promoción desconocida'})`).join(', ')}.</div>` : ''}
${stub ? `<div class="ambox">Este artículo sobre un colegial es un <b>esbozo</b>. Puedes ayudar a Santacruzpedia completando sus datos en la base de datos.</div>` : ''}
${infobox(esc(c.mote), `<a href="/foto/${encodeURIComponent(c.id)}" target="_blank">${img(c).replace('loading="lazy"', '')}</a>`, [
      ['Nombre', esc(c.nombre)], ['Mote', `<b>${esc(c.mote)}</b>`], ['Otros apodos', c.apodos.map(esc).join(', ')],
      ['Nacimiento', c.nacimiento ? `${fecha(c.nacimiento)} (${edad(c.nacimiento)} años)` : ''], ['Procedencia', lugar],
      ['Vida colegial'], ['Promoción', c.promo], ['Estado', actual ? 'Colegial actual' : (c.estancias.length ? 'Antiguo colegial' : '')],
      ['Cursos', c.estancias.length ? `${c.estancias[0].curso} – ${ult.curso} (${c.estancias.length})` : ''],
      ['Habitación', ult?.hab ? L.hab(ult.hab) : ''], ['Estudios', estudios.map(L.est).join('<br>')],
      ['Padrino', padrino ? L.col(padrino) : (c.pid ? L.colId(c.pid) : '')], ['Ahijados', c.ahijados.map(L.col).join(', ')],
      ['Insignia', c.foto_insignia?.startsWith('http') ? `<a href="${esc(c.foto_insignia)}" target="_blank" rel="noopener">Foto en Flickr</a>` : ''],
    ], esc(c.nombre || c.mote))}
<p><b>${esc(c.nombre || c.mote)}</b>${c.nacimiento || c.procedencia ? ` (${[c.procedencia && esc(c.procedencia), c.nacimiento && fecha(c.nacimiento)].filter(Boolean).join(', ')})` : ''}, conocido en el colegio como <b>«${esc(c.mote)}»</b>${c.apodos.length ? ` o también ${c.apodos.map(a => `<b>«${esc(a)}»</b>`).join(', ')}` : ''}, ${actual ? 'es' : 'fue'} colegial del <a href="/wiki/Colegio_Mayor_Santa_Cruz">Colegio Mayor Santa Cruz</a>${c.promo ? ` perteneciente a la promoción de ${c.promo}` : ''}.${estudios.length ? ` ${actual ? 'Estudia' : 'Estudió'} ${estudios.map(L.est).join(' y ')}.` : ''}${padrino ? ` Fue apadrinado por ${L.col(padrino)}.` : ''}</p>
${c.estancias.length ? `<h2>Trayectoria en el colegio</h2>${tabla(['Curso', 'Habitación', 'Planta', 'Estudios', 'Director'], c.estancias.map(e => [L.curso(e.curso), L.hab(e.hab), PISOS[D.habs.get(e.hab)?.piso] || '', L.est(e.estudio), L.dir(D.cursos.get(e.curso)?.director)]))}` : ''}
${linaje.length || c.ahijados.length ? `<h2>Linaje colegial</h2><div class="lineage">${linaje.map(x => `<div class="node">${img(x)}${L.col(x)}<small>${x.promo ?? ''}</small></div><div class="arrow">↓</div>`).join('')}
<div class="node me">${img(c)}<b>${esc(c.mote)}</b><small>${c.promo ?? ''}</small></div>
${c.ahijados.length ? `<div class="arrow">↓</div><div class="kids">${c.ahijados.map(x => `<div class="node">${img(x)}${L.col(x)}<small>${x.promo ?? ''}</small></div>`).join('')}</div>` : ''}</div>` : ''}
${c.estancias.length ? `<h2>Eventos durante su estancia</h2><ul>${c.estancias.flatMap(e => D.cursos.get(e.curso).eventos.map(ev => `<li>${L.ev(ev)} (${e.curso})</li>`)).join('') || '<li>No hay eventos registrados en sus cursos.</li>'}</ul>` : ''}
${companeros.length ? `<h2>Compañeros de promoción</h2>${galeria(companeros)}` : ''}`,
  });
});

// Lista de colegiales
app.get('/colegiales', (req, res) => {
  const promos = {}; for (const c of D.cols.values()) (promos[c.promo ?? 'Desconocida'] ||= []).push(c);
  const keys = Object.keys(promos).filter(k => k !== 'Desconocida').sort().reverse().concat(promos.Desconocida ? ['Desconocida'] : []);
  pagina(res, {
    titulo: 'Anexo:Colegiales del Colegio Mayor Santa Cruz', cuerpo: `<p>Lista de los ${D.cols.size} colegiales registrados, ordenados por promoción (año de ingreso).</p>
<input class="filtro" data-filtro=".gal, #tcol tbody tr" placeholder="Filtrar por mote, nombre, procedencia…">
${keys.map(k => `<h2>${k === 'Desconocida' ? 'Promoción desconocida' : `Promoción de ${k}`}</h2>${galeria(promos[k].sort((a, b) => a.mote.localeCompare(b.mote)), c => esc(c.nombre || ''))}`).join('')}
<h2>Tabla completa</h2><div id="tcol">${tabla(['Mote', 'Nombre', 'Promoción', 'Procedencia', 'Padrino', 'Cursos', 'Ahijados'], [...D.cols.values()].map(c => [L.col(c), esc(c.nombre), c.promo, L.loc(c.procedencia), c.pid ? L.colId(c.pid) : '', c.estancias.length, c.ahijados.length]))}</div>`,
  });
});

// Árbol de padrinos
app.get('/arbol', (req, res) => {
  const raices = [...D.cols.values()].filter(c => c.ahijados.length && !D.cols.has(c.pid)).sort((a, b) => b.ahijados.length - a.ahijados.length);
  const rama = (c, v = new Set()) => { if (v.has(c.id)) return ''; v.add(c.id); return `<li><span class="tn">${img(c)}${L.col(c)} <small>${c.promo ?? ''}</small></span>${c.ahijados.length ? `<ul>${c.ahijados.sort((a, b) => a.id.localeCompare(b.id)).map(x => rama(x, v)).join('')}</ul>` : ''}</li>`; };
  const huerfanos = [...D.cols.values()].filter(c => !c.ahijados.length && !D.cols.has(c.pid));
  pagina(res, {
    titulo: 'Árbol de padrinos', cuerpo: `<p>Cada colegial nuevo es apadrinado por un veterano. Estos son los ${raices.length} grandes linajes del colegio, empezando por el fundador de cada uno.</p>
${raices.map(r => `<h2>Linaje de ${esc(r.mote)}</h2><ul class="tree">${rama(r)}</ul>`).join('')}
<h2>Colegiales sin linaje registrado</h2><p>${huerfanos.map(L.col).join(' · ')}</p>`,
  });
});

// Cursos
app.get('/cursos', (req, res) => pagina(res, {
  titulo: 'Cursos', cuerpo: tabla(['Curso', 'Director', 'Colegiales', 'Novatos', 'Eventos'], [...D.cursos.values()].map(c => [L.curso(c.id), L.dir(c.director), c.miembros.length, c.miembros.filter(m => m.col.estancias[0].curso === c.id).length, c.eventos.length])),
}));
app.get('/curso/:id', (req, res) => {
  const c = D.cursos.get(req.params.id); if (!c) return noExiste(res, req.params.id);
  const ks = [...D.cursos.keys()], i = ks.indexOf(c.id);
  const novatos = c.miembros.filter(m => m.col.estancias[0].curso === c.id).map(m => m.col);
  const pisos = [0, 1, 2].map(p => [p, c.miembros.filter(m => D.habs.get(m.hab)?.piso === p).sort((a, b) => a.hab - b.hab)]);
  pagina(res, {
    titulo: `Curso ${c.id}`, cats: ['Cursos'],
    cuerpo: infobox(`Curso ${c.id}`, '', [['Director', L.dir(c.director)], ['Colegiales', c.miembros.length], ['Novatos', novatos.length], ['Eventos', c.eventos.length], ['Anterior', i > 0 ? L.curso(ks[i - 1]) : ''], ['Siguiente', i < ks.length - 1 ? L.curso(ks[i + 1]) : '']]) +
      `<p>El <b>curso ${c.id}</b> ${c.id === D.actual ? 'es el curso actual' : 'fue un curso académico'} del Colegio Mayor Santa Cruz${c.director ? `, bajo la dirección de ${L.dir(c.director)}` : ''}. ${plural(c.miembros.length, 'colegial', 'colegiales')} residieron en el colegio${novatos.length ? `, ${novatos.length} de ellos novatos` : ''}.</p>
${c.eventos.length ? `<h2>Eventos</h2><ul>${c.eventos.map(e => `<li>${L.ev(e)}${e.info ? ` — ${esc(e.info.slice(0, 120))}${e.info.length > 120 ? '…' : ''}` : ''}</li>`).join('')}</ul>` : ''}
${novatos.length ? `<h2>Novatos</h2>${galeria(novatos, n => n.pid ? `padrino: ${esc(D.cols.get(n.pid)?.mote || n.pid)}` : '')}` : ''}
<h2>Colegiales por planta</h2>${pisos.filter(p => p[1].length).map(([p, ms]) => `<h3>${PISOS[p]}</h3>${galeria(ms.map(m => m.col), x => `hab. ${ms.find(m => m.col === x).hab}`)}`).join('')}
${c.miembros.some(m => !m.hab) ? `<h3>Sin habitación registrada</h3>${galeria(c.miembros.filter(m => !m.hab).map(m => m.col))}` : ''}`,
  });
});

// Directores
app.get('/director/:id', (req, res) => {
  const d = D.directores.get(req.params.id); if (!d) return noExiste(res, req.params.id);
  const cs = [...D.cursos.values()].filter(c => c.directorid === d.id);
  const cols = new Set(cs.flatMap(c => c.miembros.map(m => m.col)));
  pagina(res, {
    titulo: esc(d.nombre), cats: ['Directores del Colegio Mayor Santa Cruz'],
    cuerpo: infobox(esc(d.nombre), '', [['Cargo', 'Director del Colegio Mayor Santa Cruz'], ['Cursos', cs.map(c => L.curso(c.id)).join('<br>')], ['Cátedra', L.est(d.catedra) === '—' ? '' : L.est(d.catedra)], ['Colegiales a su cargo', cols.size]]) +
      `<p><b>${esc(d.nombre)}</b> ${cs.at(-1)?.id === D.actual ? 'es el actual director' : 'fue director'} del Colegio Mayor Santa Cruz${cs.length ? ` durante ${plural(cs.length, 'curso')} (${cs[0].id} – ${cs.at(-1).id})` : ''}, periodo en el que pasaron por el colegio ${cols.size} colegiales.</p>
<h2>Colegiales durante su mandato</h2>${galeria([...cols].sort((a, b) => a.mote.localeCompare(b.mote)))}`,
  });
});

// Eventos
app.get('/eventos', (req, res) => pagina(res, {
  titulo: 'Eventos', cuerpo: `<p>Eventos registrados en la historia del colegio.</p>${[...D.cursos.values()].filter(c => c.eventos.length).reverse().map(c => `<h2>${c.id}</h2><ul>${c.eventos.map(e => `<li>${L.ev(e)}${e.info ? ' 📖' : ''}</li>`).join('')}</ul>`).join('')}`,
}));
app.get('/evento/:curso/:nombre', (req, res) => {
  const e = D.eventos.find(x => x.cursoid === req.params.curso && x.nombre === req.params.nombre); if (!e) return noExiste(res, req.params.nombre);
  const otras = D.eventos.filter(x => x !== e && norm(x.nombre) === norm(e.nombre));
  const cu = D.cursos.get(e.cursoid);
  const nombres = [...cu.miembros.map(m => m.col)].sort((a, b) => b.mote.length - a.mote.length);
  let texto = esc(e.info || '');
  for (const c of nombres) if (c.mote.length > 3) texto = texto.replace(new RegExp(`(^|[^\\p{L}>])(${c.mote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}<])`, 'u'), `$1<a href="/colegial/${c.id}">$2</a>`);
  pagina(res, {
    titulo: `${esc(e.nombre)} (${e.cursoid})`, cats: ['Eventos', `Curso ${e.cursoid}`],
    cuerpo: infobox(esc(e.nombre), '', [['Curso', L.curso(e.cursoid)], ['Inicio', fecha(e.inicio)], ['Fin', fecha(e.fin)], ['Director', L.dir(cu.director)], ['Fotos', e.fotosurl ? `<a href="${esc(e.fotosurl)}" target="_blank">Ver álbum</a>` : '']]) +
      `<p>La <b>${esc(e.nombre)}</b> fue un evento celebrado durante el curso ${L.curso(e.cursoid)} en el Colegio Mayor Santa Cruz.</p>
${e.info ? `<h2>Crónica</h2><p>${texto.replace(/\n+/g, '</p><p>')}</p>` : `<div class="ambox">No hay crónica de este evento. ¿Estuviste? Añádela a la base de datos.</div>`}
${otras.length ? `<h2>Otras ediciones</h2><ul>${otras.map(o => `<li>${L.ev(o)} (${o.cursoid})</li>`).join('')}</ul>` : ''}`,
  });
});

// Habitaciones
app.get('/habitaciones', (req, res) => {
  const ocup = h => h.historial.find(e => e.curso === D.actual)?.col;
  pagina(res, {
    titulo: 'Habitaciones', cuerpo: `<p>El colegio cuenta con ${D.habs.size} habitaciones repartidas en tres plantas.</p>
${[0, 1, 2].map(p => `<h2 id="p${p}">${PISOS[p]}</h2><figure class="thumb"><img src="/plano/${p}" alt="Plano ${PISOS[p]}"><figcaption>Plano de ${PISOS[p].toLowerCase()}</figcaption></figure>
${tabla(['Hab.', 'Superficie', 'Residente actual', 'Residentes históricos', 'Descripción'], [...D.habs.values()].filter(h => h.piso === p).map(h => [L.hab(h.id), h.superficie ? `${h.superficie} m²` : '', ocup(h) ? L.col(ocup(h)) : '<i>Vacía</i>', h.historial.length, esc((h.descripcion || '').slice(0, 90)) + ((h.descripcion || '').length > 90 ? '…' : '')]))}`).join('')}`,
  });
});
app.get('/habitacion/:id', (req, res) => {
  const h = D.habs.get(+req.params.id); if (!h) return noExiste(res, 'Habitación ' + req.params.id);
  const act = h.historial.find(e => e.curso === D.actual)?.col;
  pagina(res, {
    titulo: `Habitación ${h.id}`, cats: ['Habitaciones', PISOS[h.piso]],
    cuerpo: infobox(`Habitación ${h.id}`, act ? img(act) : '', [['Planta', PISOS[h.piso]], ['Superficie', h.superficie ? `${h.superficie} m²` : 'Desconocida'], ['Residente actual', act ? L.col(act) : 'Vacía'], ['Residentes históricos', h.historial.length], ['Anterior', D.habs.has(h.id - 1) ? L.hab(h.id - 1) : ''], ['Siguiente', D.habs.has(h.id + 1) ? L.hab(h.id + 1) : '']], act ? `Residente actual: ${esc(act.mote)}` : '') +
      `<p>La <b>habitación ${h.id}</b> es una de las habitaciones de ${PISOS[h.piso]?.toLowerCase()} del Colegio Mayor Santa Cruz.</p>
<h2>Descripción</h2><p>${esc(h.descripcion || 'Aún no hay descripción para esta habitación.')}</p>
<h2>Historial de residentes</h2>${h.historial.length ? galeria(h.historial.map(e => e.col), x => h.historial.filter(e => e.col === x).map(e => e.curso).join(', ')) : '<p>Sin residentes registrados.</p>'}
<h2>Plano</h2><figure class="thumb"><img src="/plano/${h.piso}" alt=""><figcaption>${PISOS[h.piso]}</figcaption></figure>`,
  });
});

// Estudios y procedencias
app.get('/estudios', (req, res) => {
  const n = id => new Set([...D.cols.values()].filter(c => c.estancias.some(e => e.estudio === id)).map(c => c.id)).size;
  pagina(res, { titulo: 'Estudios', cuerpo: tabla(['Estudio', 'Tipo', 'Colegiales'], [...D.estudios.values()].map(e => [L.est(e.id), e.tipo, n(e.id)]).sort((a, b) => b[2] - a[2])) });
});
app.get('/estudio/:id', (req, res) => {
  const e = D.estudios.get(req.params.id); if (!e) return noExiste(res, req.params.id);
  const cols = [...D.cols.values()].filter(c => c.estancias.some(x => x.estudio === e.id));
  pagina(res, { titulo: esc(e.nombre), cats: ['Estudios'], cuerpo: `<p><b>${esc(e.nombre)}</b> (${e.tipo}) es la titulación cursada por ${plural(cols.length, 'colegial', 'colegiales')} del Colegio Mayor Santa Cruz.</p><h2>Colegiales</h2>${galeria(cols)}` });
});
app.get('/procedencias', (req, res) => {
  const g = {}; for (const c of D.cols.values()) if (c.procedencia) (g[c.procedencia] ||= []).push(c);
  const porProv = {}; for (const [l, cs] of Object.entries(g)) { const u = D.ubic.get(l); const k = u?.provincia ? PROV[u.provincia] : (PAIS[u?.pais] || 'Otros'); (porProv[k] ||= []).push([l, cs]); }
  const orden = Object.entries(porProv).sort((a, b) => b[1].reduce((s, x) => s + x[1].length, 0) - a[1].reduce((s, x) => s + x[1].length, 0));
  const max = orden[0]?.[1].reduce((s, x) => s + x[1].length, 0) || 1;
  pagina(res, {
    titulo: 'Procedencias', cuerpo: `<p>De dónde vienen los colegiales.</p><div class="bars">${orden.map(([p, ls]) => { const n = ls.reduce((s, x) => s + x[1].length, 0); return `<div><span>${esc(p)}</span><i style="width:${n / max * 100}%"></i><b>${n}</b></div>`; }).join('')}</div>
${orden.map(([p, ls]) => `<h2>${esc(p)}</h2><ul>${ls.sort((a, b) => b[1].length - a[1].length).map(([l, cs]) => `<li>${L.loc(l)}: ${cs.map(L.col).join(', ')}</li>`).join('')}</ul>`).join('')}`,
  });
});
app.get('/procedencia/:loc', (req, res) => {
  const u = D.ubic.get(req.params.loc); const cols = [...D.cols.values()].filter(c => c.procedencia === req.params.loc);
  if (!u && !cols.length) return noExiste(res, req.params.loc);
  pagina(res, {
    titulo: esc(req.params.loc), cats: ['Localidades', u?.provincia && `Provincia de ${PROV[u.provincia]}`].filter(Boolean),
    cuerpo: infobox(esc(req.params.loc), '', [['Provincia', PROV[u?.provincia] || ''], ['País', PAIS[u?.pais] || u?.pais || ''], ['Colegiales', cols.length]]) +
      `<p><b>${esc(req.params.loc)}</b>${u?.provincia ? ` (provincia de ${PROV[u.provincia]})` : ''} es la localidad de procedencia de ${plural(cols.length, 'colegial', 'colegiales')} del Colegio Mayor Santa Cruz.</p><h2>Colegiales</h2>${galeria(cols)}`,
  });
});

// Biblioteca
app.get('/biblioteca', (req, res) => {
  const gen = {}; for (const l of D.libros) { const g = l.genero || 'Sin género'; gen[g] = (gen[g] || 0) + 1; }
  pagina(res, {
    titulo: 'Biblioteca del Colegio', cuerpo: `<p>La biblioteca del colegio reúne <b>${D.libros.length}</b> volúmenes, desde ${Math.min(...D.libros.filter(l => l.fecha).map(l => l.fecha))} hasta ${Math.max(...D.libros.filter(l => l.fecha).map(l => l.fecha))}.</p>
<h2>Géneros</h2><p>${Object.entries(gen).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${esc(g)} (${n})`).join(' · ')}</p>
<h2>Catálogo</h2><input class="filtro" data-filtro="#tlib tbody tr" placeholder="Filtrar por título, autor, editorial…"><div id="tlib">${tabla(['Nº', 'Título', 'Autor', 'Género', 'Editorial', 'Año', 'Ubicación'], D.libros.map(l => [l.id, L.libro(l), esc(l.autor), esc(l.genero), esc(l.editorial), l.fecha, esc(l.localizacion)]))}</div>`,
  });
});
app.get('/libro/:id', (req, res) => {
  const l = D.libros.find(x => x.id === +req.params.id); if (!l) return noExiste(res, 'libro ' + req.params.id);
  const mismo = D.libros.filter(x => x !== l && x.autor && x.autor === l.autor);
  pagina(res, {
    titulo: `<i>${esc(l.titulo)}</i>`, cats: ['Libros de la biblioteca', l.genero && esc(l.genero)].filter(Boolean),
    cuerpo: infobox(`<i>${esc(l.titulo)}</i>`, l.isbn ? `<img src="https://covers.openlibrary.org/b/isbn/${esc(l.isbn)}-M.jpg" onerror="this.remove()" style="max-width:160px">` : '', [['Autor', esc(l.autor)], ['Género', esc(l.genero)], ['Editorial', esc(l.editorial)], ['Año', l.fecha], ['ISBN', esc(l.isbn)], ['Ubicación', esc(l.localizacion)], ['Observaciones', esc(l.observaciones)], ['Nº de registro', l.id]]) +
      `<p><i><b>${esc(l.titulo)}</b></i>${l.autor ? ` es una obra de ${esc(l.autor)}` : ' es una obra'}${l.fecha ? ` publicada en ${l.fecha}` : ''}${l.editorial ? ` por ${esc(l.editorial)}` : ''}. Un ejemplar se conserva en la <a href="/biblioteca">biblioteca del colegio</a>${l.localizacion ? `, en la estantería ${esc(l.localizacion)}` : ''}.</p>
${mismo.length ? `<h2>Otras obras de ${esc(l.autor)} en la biblioteca</h2><ul>${mismo.map(x => `<li>${L.libro(x)}${x.fecha ? ` (${x.fecha})` : ''}</li>`).join('')}</ul>` : ''}`,
  });
});

// Búsqueda y aleatorio
app.get('/buscar', (req, res) => {
  const q = norm(req.query.q).trim(); if (!q) return res.redirect('/');
  const r = [];
  for (const c of D.cols.values()) if ([c.mote, c.nombre, c.id, ...c.apodos].some(x => norm(x).includes(q))) r.push([norm(c.mote) === q || c.apodos.some(a => norm(a) === q) ? 0 : 1, `/colegial/${c.id}`, c.mote, `Colegial · ${c.nombre || ''} · ${c.promo ? `promoción ${c.promo}` : 'promoción desconocida'}`, c]);
  for (const c of D.cursos.keys()) if (c.includes(q)) r.push([1, `/curso/${c}`, `Curso ${c}`, 'Curso académico']);
  for (const e of D.eventos) if (norm(e.nombre).includes(q)) r.push([2, `/evento/${e.cursoid}/${encodeURIComponent(e.nombre)}`, `${e.nombre} (${e.cursoid})`, 'Evento']);
  for (const e of D.estudios.values()) if (norm(e.nombre).includes(q)) r.push([2, `/estudio/${e.id}`, e.nombre, 'Estudios']);
  for (const l of D.ubic.keys()) if (norm(l).includes(q)) r.push([2, `/procedencia/${encodeURIComponent(l)}`, l, 'Localidad']);
  for (const h of D.habs.keys()) if (q === String(h) || q === 'habitacion ' + h) r.push([0, `/habitacion/${h}`, `Habitación ${h}`, 'Habitación']);
  for (const l of D.libros) if (norm(l.titulo).includes(q) || norm(l.autor).includes(q)) r.push([3, `/libro/${l.id}`, l.titulo, `Libro · ${l.autor || ''}`]);
  r.sort((a, b) => a[0] - b[0]);
  const exactos = r.filter(x => x[0] === 0);
  if (exactos.length === 1) return res.redirect(exactos[0][1]);
  pagina(res, { titulo: 'Resultados de la búsqueda', cuerpo: `<p>${r.length} resultados para «<b>${esc(req.query.q)}</b>».</p><ul class="results">${r.slice(0, 200).map(([, u, t, d, c]) => `<li>${c ? img(c, 'mini') : ''}<div><a href="${u}">${esc(t)}</a><br><small>${esc(d)}</small></div></li>`).join('')}</ul>` });
});
app.get('/aleatorio', (req, res) => {
  const cs = [...D.cols.keys()];
  res.redirect(`/colegial/${encodeURIComponent(cs[Math.floor(Math.random() * cs.length)])}`);
});
app.use((req, res) => noExiste(res, decodeURIComponent(req.path.slice(1))));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('Error interno: ' + esc(err.message)); });

// ---------- arranque ----------
app.listen(PORT, () => console.log(`Santacruzpedia en http://localhost:${PORT}`));
await cargar();
setInterval(() => cargar().catch(e => console.error('Recarga fallida:', e.message)), 5 * 60 * 1000);
// precarga de fotos en segundo plano
for (const id of D.cols.keys()) await foto(id);
console.log(`Fotos precargadas: ${[...fotos.values()].filter(Boolean).length}`);
