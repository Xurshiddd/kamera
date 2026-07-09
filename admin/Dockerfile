# =============================================================================
#  Admin (Nuxt SPA) — Docker ichida quriladi va nginx bilan beriladi.
#  Host'da Node/npm KERAK EMAS: `docker compose up --build` hammasini qiladi.
#
#  Chiqadigan nginx bir vaqtda uchta ishni bajaradi (gateway.conf orqali):
#    /        -> admin SPA (statik)
#    /api/    -> service:4000 ga proxy (same-origin, CORS yo'q)
#    /hls/    -> MediaMTX yozgan statik HLS fayllar (session/cookiesiz)
# =============================================================================

# --- 1-bosqich: Nuxt static generate ---
FROM node:22-alpine AS build
WORKDIR /app

# Avval faqat manifestlar -> `npm ci` qatlami keshlanadi (kod o'zgarsa qayta yuklanmaydi).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# nuxt.config'da serviceBase="" (default) -> admin `/api` ni SHU domendan chaqiradi,
# nginx uni service:4000 ga uzatadi. Shu sabab build vaqtida domen bilish shart emas.
RUN npm run generate

# --- 2-bosqich: nginx statik server ---
FROM nginx:alpine
COPY --from=build /app/.output/public /usr/share/nginx/html
EXPOSE 80
