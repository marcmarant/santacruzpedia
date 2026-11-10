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

// Cuadros de filtro: <input data-filtro="selector de los elementos a filtrar">
document.querySelectorAll('input[data-filtro]').forEach(inp => {
  inp.addEventListener('input', () => {
    const q = inp.value.toLowerCase();
    document.querySelectorAll(inp.dataset.filtro).forEach(el => {
      el.style.display = el.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
  });
});
