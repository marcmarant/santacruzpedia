// Comportamiento en el navegador: modo oscuro, índice de contenidos, tablas ordenables y filtros

document.getElementById('tema')?.addEventListener('click', () => {
  const oscuro = document.documentElement.classList.toggle('dark');
  localStorage.dark = oscuro ? '1' : '';
});

// Índice "Contenidos" a partir de los <h2> del artículo
(() => {
  const h2s = [...document.querySelectorAll('.content h2')];
  const toc = document.getElementById('toc');
  if (!toc || h2s.length < 3) return;
  toc.innerHTML = '<h4>Contenidos</h4><a href="#top">(Inicio)</a>';
  h2s.forEach((h, i) => {
    h.id ||= 's' + (i + 1);
    const a = document.createElement('a');
    a.className = 'toc'; a.href = '#' + h.id; a.textContent = h.textContent;
    toc.appendChild(a);
  });
})();

// Tablas ordenables al pulsar la cabecera
document.querySelectorAll('table.sortable th').forEach((th, i) => {
  th.addEventListener('click', () => {
    const tb = th.closest('table').tBodies[0];
    const filas = [...tb.rows];
    const asc = th.dataset.o !== 'a';
    th.dataset.o = asc ? 'a' : 'd';
    const valor = f => {
      const t = f.cells[i]?.innerText.trim() || '';
      const n = parseFloat(t.replace(',', '.'));
      return isNaN(n) || !/^[\d.,-]+/.test(t) ? t.toLowerCase() : n;
    };
    filas.sort((a, b) => { const x = valor(a), y = valor(b); return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1); });
    filas.forEach(f => tb.appendChild(f));
  });
});

// Formularios del panel que tardan en guardar: el botón muestra un spinner y no se puede pulsar dos veces
document.querySelectorAll('form.formulario-registro').forEach(f => {
  f.addEventListener('submit', e => {
    const b = e.submitter || f.querySelector('button.primario');
    if (f.dataset.enviando) { e.preventDefault(); return; }
    f.dataset.enviando = '1';
    b?.classList.add('cargando');
    b?.setAttribute('aria-busy', 'true');
  });
});
// al volver con el botón «Atrás» la página puede salir de la caché con el botón aún cargando
addEventListener('pageshow', () => document.querySelectorAll('form[data-enviando]').forEach(f => {
  delete f.dataset.enviando;
  f.querySelectorAll('.cargando').forEach(b => { b.classList.remove('cargando'); b.removeAttribute('aria-busy'); });
}));

// «Cambiar la clave» al modificar un registro: activa o desactiva los campos de la clave del formulario
document.querySelectorAll('input[data-desbloquear-clave]').forEach(casilla => {
  const campos = casilla.form.querySelectorAll('[data-clave]');
  const aplicar = () => campos.forEach(c => { c.disabled = !casilla.checked; });
  casilla.addEventListener('change', aplicar);
  aplicar();
});

// Desplegables que sustituyen a las pestañas en el móvil: al elegir una opción se abre esa página
document.querySelectorAll('select[data-navegar]').forEach(s => {
  s.addEventListener('change', () => { location.href = s.value; });
});

// ---------- Fotos ----------

// Visor: al pulsar una foto subida (en el texto, la galería o la ficha) se abre en grande sobre la página
(() => {
  const enlaces = document.querySelectorAll('a.foto-img[data-grande]');
  if (!enlaces.length) return;
  const visor = document.createElement('dialog');
  visor.className = 'visor-fotos';
  visor.innerHTML = '<button type="button" class="cerrar" aria-label="Cerrar">×</button><img alt="" /><p class="pie"></p><a class="detalles">Detalles de la foto</a>';
  document.body.appendChild(visor);
  const img = visor.querySelector('img'), pie = visor.querySelector('.pie'), detalles = visor.querySelector('.detalles');
  visor.querySelector('.cerrar').addEventListener('click', () => visor.close());
  visor.addEventListener('click', e => { if (e.target === visor) visor.close(); });   // clic fuera de la foto
  enlaces.forEach(a => a.addEventListener('click', e => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;   // abrir en otra pestaña: la página de la foto
    e.preventDefault();
    img.src = a.dataset.grande; img.alt = a.dataset.pie || '';
    pie.textContent = a.dataset.pie || ''; detalles.href = a.href;
    visor.showModal();
  }));
})();

// Apartado «Fotos» del editor (ver src/components/PanelFotos.astro)
document.querySelectorAll('[data-panel-fotos]').forEach(panel => {
  const form = panel.closest('form');
  const texto = form.querySelector('textarea[name=contenido]');
  const campoImagen = panel.querySelector('input[name=imagen]');
  const vistaPrincipal = panel.querySelector('[data-principal-vista]');
  const quitarPrincipal = panel.querySelector('[data-quitar-principal]');
  const lista = panel.querySelector('[data-lista-fotos]');
  const elegir = panel.querySelector('[data-elegir-fotos]');
  const soltar = panel.querySelector('[data-soltar]');
  const iniciales = JSON.parse(panel.querySelector('[data-fotos-iniciales]').textContent);

  const el = (etiqueta, props = {}, ...hijos) => {
    const e = Object.assign(document.createElement(etiqueta), props);
    e.append(...hijos.filter(h => h != null));
    return e;
  };
  const boton = (texto, accion, clase) => {
    const b = el('button', { type: 'button', textContent: texto, className: clase || '' });
    b.addEventListener('click', accion);
    return b;
  };

  // foto principal
  const pintarPrincipal = f => {
    campoImagen.value = f ? f.nombre : '';
    vistaPrincipal.replaceChildren(f ? el('span', { className: 'elegida' }, el('img', { src: f.miniatura, alt: '' }), f.nombre) : el('i', { textContent: 'ninguna' }));
    quitarPrincipal.hidden = !f;
  };
  quitarPrincipal.addEventListener('click', () => pintarPrincipal(null));
  pintarPrincipal(iniciales.principal);

  // escribir en el texto donde esté el cursor
  const insertar = t => {
    const ini = texto.selectionStart ?? texto.value.length, fin = texto.selectionEnd ?? ini;
    texto.setRangeText(t, ini, fin, 'end');
    texto.focus();
  };
  const conPie = f => f.descripcion ? `${f.nombre}|${f.descripcion}` : f.nombre;
  const ponerEnTexto = f => insertar(`[[Archivo:${conPie(f)}]]\n`);
  const ponerEnGaleria = f => {
    const linea = `Archivo:${conPie(f)}\n`;
    const fin = texto.value.search(/<\/galeria>/i);
    if (fin >= 0) { texto.setRangeText(linea, fin, fin, 'end'); texto.focus(); }
    else insertar(`\n<galeria>\n${linea}</galeria>\n`);
  };

  // tarjeta de una foto ya subida: botones para usarla
  const tarjetaSubida = (f, aviso) => el('li', { className: 'subida' },
    el('img', { src: f.miniatura, alt: '' }),
    el('div', {},
      el('b', { textContent: f.nombre }),
      f.descripcion ? el('div', { className: 'nota', textContent: f.descripcion }) : null,
      aviso ? el('div', { className: 'nota', textContent: aviso }) : null,
      el('div', { className: 'acciones' },
        boton('Poner en el texto', () => ponerEnTexto(f)),
        boton('Añadir a la galería', () => ponerEnGaleria(f)),
        boton('Foto principal', () => pintarPrincipal(f)))));

  // tarjeta de una foto elegida pero aún sin subir: nombre, pie y autor
  const tarjetaNueva = fichero => {
    const nombre = el('input', { value: fichero.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), maxLength: 140, required: true });
    const pie = el('input', { maxLength: 500, placeholder: 'Ej.: La mesa presidencial en la cena de gala' });
    const deOtro = el('input', { type: 'checkbox' });
    const autor = el('input', { maxLength: 200, placeholder: 'Nombre del autor', disabled: true });
    deOtro.addEventListener('change', () => { autor.disabled = !deOtro.checked; if (deOtro.checked) autor.focus(); });
    const errores = el('ul', { className: 'errores' });
    const subir = el('button', { type: 'button', className: 'primario', textContent: 'Subir' });
    const li = el('li', { className: 'nueva' },
      el('img', { src: URL.createObjectURL(fichero), alt: '' }),
      el('div', {},
        el('label', {}, 'Nombre', nombre),
        el('label', {}, 'Pie de foto (opcional)', pie),
        el('label', { className: 'casilla' }, deOtro, 'La foto es de otra persona:'), autor,
        errores,
        el('div', { className: 'acciones' }, subir, boton('Descartar', () => li.remove(), 'enlace'))));
    subir.addEventListener('click', async () => {
      if (!nombre.value.trim()) { nombre.focus(); return; }
      const datos = new FormData();
      datos.append('archivo', fichero);
      datos.append('nombre', nombre.value);
      datos.append('descripcion', pie.value);
      if (deOtro.checked) datos.append('autor', autor.value);
      subir.disabled = true; subir.classList.add('cargando'); errores.replaceChildren();
      try {
        const r = await fetch('/archivo/subir', { method: 'POST', body: datos });
        const res = await r.json().catch(() => ({ errores: [`Error del servidor (${r.status}).`] }));
        if (res.archivo) {
          li.replaceWith(tarjetaSubida(res.archivo, res.yaExistia ? 'Esta foto ya estaba subida con este nombre; puedes usarla.' : null));
          return;
        }
        errores.replaceChildren(...(res.errores || ['No se ha podido subir.']).map(t => el('li', { textContent: t })));
      } catch {
        errores.replaceChildren(el('li', { textContent: 'No se ha podido conectar. Revisa la conexión e inténtalo otra vez.' }));
      }
      subir.disabled = false; subir.classList.remove('cargando');
    });
    return li;
  };

  iniciales.subidas.forEach(f => lista.append(tarjetaSubida(f)));
  const anadir = ficheros => [...ficheros].filter(f => f.type.startsWith('image/')).forEach(f => lista.append(tarjetaNueva(f)));
  elegir.addEventListener('change', () => { anadir(elegir.files); elegir.value = ''; });
  soltar.addEventListener('dragover', e => { e.preventDefault(); soltar.classList.add('encima'); });
  soltar.addEventListener('dragleave', () => soltar.classList.remove('encima'));
  soltar.addEventListener('drop', e => { e.preventDefault(); soltar.classList.remove('encima'); anadir(e.dataTransfer.files); });

  // aviso si se envía con fotos elegidas que no se han subido
  form.addEventListener('submit', e => {
    if (e.submitter?.value === 'enviar' && lista.querySelector('li.nueva')
        && !confirm('Hay fotos que has elegido pero no has subido (botón «Subir»). ¿Enviar la propuesta sin ellas?')) e.preventDefault();
  });
});

// Cuadros de filtro: <input data-filtro="selector de los elementos a filtrar">
document.querySelectorAll('input[data-filtro]').forEach(inp => {
  inp.addEventListener('input', () => {
    const q = inp.value.toLowerCase();
    document.querySelectorAll(inp.dataset.filtro).forEach(el => {
      el.style.display = el.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
  });
});
