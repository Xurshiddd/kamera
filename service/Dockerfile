FROM node:20-trixie-slim
WORKDIR /app
# python3/make/g++ -> better-sqlite3 native build
# ffmpeg        -> ichida `ffprobe` bor: kamera H264 mi H265 mi — avtomatik aniqlaymiz
# trixie (Debian 13) -> ffmpeg 7.1: bookworm’dagi 5.1 yangi Hikvision kameralar
#   (3200x1800 H.265) yozuvlarini ocholmaydi ("PPS id out of range").
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ffmpeg \
 && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
# DB faylni volume'da saqlash uchun ishchi katalogni data'ga moslaymiz
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
