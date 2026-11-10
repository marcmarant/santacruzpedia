// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 8090, host: true },
  // Detrás de nginx/Cloudflare: se fía de X-Forwarded-Proto/Host solo para este dominio. Así la app sabe que
  // la visita llega por https (cookie segura) y el control de origen de los formularios (login…) no da 403.
  security: { allowedDomains: [{ hostname: 'wiki.cmusantacruz.org', protocol: 'https' }] },
  env: {
    schema: {
      PGHOST: envField.string({ context: 'server', access: 'secret', default: '100.107.17.5' }),
      PGPORT: envField.number({ context: 'server', access: 'secret', default: 5432 }),
      PGDATABASE: envField.string({ context: 'server', access: 'secret', default: 'scdb' }),
      PGUSER: envField.string({ context: 'server', access: 'secret' }),
      PGPASSWORD: envField.string({ context: 'server', access: 'secret' }),
      REMOTE_ASSETS: envField.string({ context: 'server', access: 'public', default: 'http://100.107.17.5' }),
      // carpeta de las fotos subidas a la wiki (relativa a la carpeta del proyecto, o absoluta)
      ARCHIVOS_DIR: envField.string({ context: 'server', access: 'secret', default: 'datos/archivos' }),
    },
  },
});
