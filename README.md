# Kamera — IP kameralarni brauzerga chiqarish

IP kameralar (RTSP) MediaMTX orqali HLS'ga aylantiriladi va brauzerda
ko'rsatiladi. Hammasi **bitta serverda (172.16.0.23), Docker'da** ishlaydi.

```
Brauzer ── https://cam.ttysi.uz ── Hestia proxy ──> http://172.16.0.23:3000
                                                          │
                                                    ┌─ gateway (nginx) ─┐
                                                    │  /      SPA: mehmon jonli sahifa (loginsiz)
                                                    │  /admin SPA: boshqaruv (/login orqali parol)
                                                    │  /api   ──> service:4000
                                                    │  /hls   statik HLS fayllar
                                                    └────────────────────┘
service  — kamera CRUD (SQLite), kodek aniqlash, MediaMTX boshqaruvi
mediamtx — RTSP tortadi, ffmpeg bilan HLS segmentlarni ./hls ga yozadi
```

**Kodek avtomatik aniqlanadi** (ffprobe):

- Kamera **H264** bersa — transkod YO'Q, video to'g'ridan-to'g'ri o'tadi (CPU ~0).
- Kamera **H265 (HEVC)** bersa — H264 ga transkod qilinadi (brauzerlar H265'ni
  HLS orqali o'ynay olmaydi).

## Deploy (172.16.0.23)

```bash
# 1. Loyihani serverga ko'chiring (git clone yoki scp)
cd kamera

# 2. Muhit sozlamalari (parol va kalitlarni ALMASHTIRING)
cp .env.example .env
nano .env

# 3. Ishga tushirish
docker compose up -d --build
```

Hestia'da `cam.ttysi.uz` domeni proxy shabloni bilan `172.16.0.23:3000` ga
yo'naltiriladi.

- Mehmon sahifa: `https://cam.ttysi.uz` — loginsiz jonli kuzatuv (2×2 grid,
  pagination, "Ko'rish" bosilganda oqim ochiladi)
- Boshqaruv: `https://cam.ttysi.uz/login` → parol → `/admin`
- HLS: `https://cam.ttysi.uz/hls/{slug}/index.m3u8` (login/parolsiz, istalgan
  saytga embed qilinadi)

## Yangilash

```bash
git pull
docker compose up -d --build
```

> Transkod buyrug'i (`service/src/mediamtx.js`) o'zgarganda MediaMTX'dagi eski
> yo'llar yangilanmaydi (mavjud yo'l uchun 400 qaytadi). To'liq yangilash:
> `docker compose up -d --build --force-recreate`

## Fayl tuzilishi

```
kamera/
├── docker-compose.yml   # butun stack (gateway :3000, service, mediamtx)
├── .env.example         # muhit namunasi (.env ga nusxalanadi, git'ga tushmaydi)
├── mediamtx.yml         # MediaMTX: statik HLS + publish himoyasi
├── gateway.conf         # nginx: SPA + /api proxy + /hls statik
├── admin/               # Nuxt SPA (Docker ichida quriladi)
└── service/             # Node API: kameralar, login, kodek aniqlash
```

Ish vaqtida yaratiladi (git'ga tushmaydi): `./data/` (kamera.db), `./hls/`
(segmentlar).

## API (tashqi tizimlar uchun)

Boshqa backend (masalan LMS) kamera API'sini `x-api-key: <SERVICE_API_KEY>`
sarlavhasi bilan chaqira oladi:

- `GET  /api/cameras` — ro'yxat (har birida `hls` URL)
- `POST /api/cameras` — qo'shish: `{ name, ip, port?, login, parol, rtspPath? }`
- `DELETE /api/cameras/:id` — o'chirish

Ochiq (kalitsiz): `GET /api/public/cameras` — mehmon sahifa ro'yxati
(faqat `id, name, slug, hls` — sirlar qaytmaydi).
