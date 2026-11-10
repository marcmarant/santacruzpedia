# Santacruzpedia: imagen de producción (Astro SSR + adaptador de Node en modo standalone)

# ---------- 1. compilación ----------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# REMOTE_ASSETS es una variable pública de astro:env: se fija al compilar (servidor de donde salen las fotos)
ARG REMOTE_ASSETS=http://100.107.17.5
ENV REMOTE_ASSETS=$REMOTE_ASSETS
RUN npm run build

# ---------- 2. ejecución ----------
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8090
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# scripts/: el panel lanza importar-articulos.mjs al añadir registros; fotos/: retratos locales (Diego de Muros…)
COPY scripts ./scripts
COPY fotos ./fotos
USER node
EXPOSE 8090
# Las credenciales de la base de datos (PGUSER, PGPASSWORD…) se pasan al arrancar, nunca van dentro de la imagen
CMD ["node", "dist/server/entry.mjs"]
