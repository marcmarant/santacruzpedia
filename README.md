# Santacruzpedia

Wiki del Colegio Mayor Santa Cruz (sede Cardenal Mendoza), hecha con **Astro** y **PostgreSQL**.

## Arrancar

- Doble clic en `start.bat` (compila y abre http://localhost:8090), o:
  - `npm run dev` — modo desarrollo, recarga al guardar cambios
  - `npm run build` y luego `npm start` — modo normal
- Las credenciales de la base de datos están en `.env`.

## Desplegar con Docker

En el servidor, con la carpeta del proyecto copiada (sin `node_modules`, `dist` ni `backups`):

1. `cp .env.example .env` y rellena `PGPASSWORD` (entre comillas simples si lleva `$`).
2. `docker compose up -d --build` — compila la imagen y deja la app en http://<servidor>:8090 (se reinicia sola).
3. Si es la primera vez y no hay moderador: `docker compose exec santacruzpedia node scripts/crear-moderador.mjs`.

- Actualizar tras cambiar el código: copia los archivos y repite `docker compose up -d --build`.
- Ver el registro: `docker compose logs -f`. Parar: `docker compose down`.
- Importar artículos a mano: `docker compose exec santacruzpedia node scripts/importar-articulos.mjs`.
- Las credenciales van en `.env` y no se copian a la imagen (ver `.dockerignore`).
- La URL de las fotos (`REMOTE_ASSETS`) se fija al compilar: `docker compose build --build-arg REMOTE_ASSETS=http://otro-servidor`.

## Cómo funciona un artículo

Cada página `/articulo/<id>` tiene tres partes:

1. **Ficha lateral**: sale de los datos del colegio (tablas de `public`).
2. **Texto**: Markdown guardado en `wiki.revision.contenido` (la versión publicada es `wiki.articulo.revision_actual`).
   - `[[Título]]` o `[[Título|texto]]` enlaza a otro artículo (rojo si no existe).
   - `[[Categoría:Nombre]]` añade una categoría.
3. **Bloques automáticos**: `{{trayectoria}}`, `{{novatos}}`… se sustituyen por tablas y galerías generadas desde los datos.
   La lista de bloques de cada tipo está en `src/lib/bloques.ts`.

## Edición y moderación

1. En cualquier artículo: **Ver código → ✎ Editar**. El lector cambia el texto, puede ver una vista previa
   y lo envía a revisión con su nombre y un resumen (`/articulo/<id>/editar`).
   La propuesta se guarda en `wiki.revision` con estado `pendiente`; el artículo no cambia todavía.
2. En **`/admin`** el moderador ve las propuestas pendientes con las diferencias resaltadas y las
   **acepta** (pasa a ser `revision_actual` y se recalculan `wiki.enlace` y `wiki.articulo_categoria`)
   o las **rechaza** (con un motivo opcional). Todo queda en `wiki.registro`.
3. **Artículos nuevos:** desde **Mis propuestas → Proponer un artículo nuevo** o pulsando un enlace rojo
   (`/articulo/nuevo?titulo=…`). Se crea en `wiki.articulo` (tipo `libre`) **sin versión publicada**
   (`revision_actual` nulo) y con su texto como propuesta pendiente; mientras tanto no aparece en la wiki.
   Al aprobarlo se publica; si se rechaza, el título queda libre para volver a proponerlo.
4. Límites: 10 propuestas por usuario y hora (los moderadores no tienen límite), textos de hasta 100 000 caracteres.
   Cada usuario sigue sus propuestas y el motivo de los rechazos en **Mis propuestas**.

## Cuentas y acceso

Toda la wiki (incluidas las fotos) exige iniciar sesión; solo `/login`, `/solicitar-acceso` y
`/invitacion/<token>` son públicas. Cada cuenta (`wiki.usuario`) suele ir unida a un colegial y su
usuario es el id del colegial (p. ej. `2021plato`). Roles: **lector** (ver y proponer cambios) y
**moderador** (además, `/admin`).

- **Primer moderador:** `npm run crear-moderador` (pide el colegial y la contraseña).
- **Invitaciones:** en `/admin/usuarios` un moderador genera un enlace de un solo uso (7 días) para
  un colegial sin cuenta; al abrirlo, el colegial elige su contraseña y entra.
- **Solicitudes de acceso:** quien no tiene invitación elige su mote en `/solicitar-acceso`, escribe
  su nombre y una nota; un moderador la aprueba o rechaza en `/admin/usuarios`.
- En `/admin/usuarios` también se puede hacer o quitar moderador y desactivar cuentas
  (desactivar cierra sus sesiones al momento).

Seguridad: contraseñas con scrypt, la cookie de sesión (30 días) no es accesible desde JavaScript y
en la base de datos solo se guarda el hash del token; 5 intentos fallidos en 15 minutos bloquean el
login por usuario e IP. Código en `src/lib/auth.ts`, `src/lib/contrasenas.ts` y `src/middleware.ts`.

## Estructura

```
src/
  lib/                 lógica sin HTML
    db.ts              conexión a PostgreSQL
    datos.ts           datos del colegio en memoria (colegiales, cursos…)
    wiki.ts            artículos, redirecciones, historial
    estado.ts          carga y recarga periódica de datos y artículos
    wikitexto.ts       Markdown + [[enlaces]] + {{bloques}} -> HTML
    articulos.ts       qué dato corresponde a cada artículo y sus categorías automáticas
    bloques.ts         bloques disponibles por tipo de artículo
    busqueda.ts, urls.ts, fotos.ts, formato.ts
  layouts/Wiki.astro   plantilla común (cabecera, menú, pestañas, categorías)
  components/
    articulos/<tipo>/Ficha.astro     ficha lateral de cada tipo
    articulos/<tipo>/Bloques.astro   bloques automáticos de cada tipo
    infobox/, Galeria.astro, Enlace.astro, Foto.astro…
  pages/               una ruta por archivo
    articulo/[id]/     index (leer), codigo, historial
    colegiales, cursos, eventos, habitaciones, arbol, estudios, procedencias, biblioteca, buscar…
    colegial/, curso/… URLs antiguas que redirigen al artículo
migrations/            cambios de la base de datos, en orden
scripts/importar-articulos.mjs   crea artículos para los datos que aún no tienen (npm run importar-articulos)
legacy/server.js       versión anterior (Express), solo como referencia
```

## Añadir un tipo de artículo nuevo

1. Crear `src/components/articulos/<tipo>/Ficha.astro` y `Bloques.astro`.
2. Registrarlos en `components/articulos/Ficha.astro` y `Bloque.astro`, y sus bloques en `lib/bloques.ts`.
3. Si se vincula a una tabla nueva, añadir la columna en `wiki.articulo` (migración) y el caso en `lib/wiki.ts` y `lib/articulos.ts`.
