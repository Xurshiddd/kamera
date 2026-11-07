# Kamera tizimi

Institut auditoriyalaridagi kameralarni brauzerda **jonli kuzatish**, Hikvision
NVR'dagi **yozuvlarni qayta ko'rish** va kerakli qismini **MP4 qilib yuklab
olish**. Dekanat xodimlari shaxsiy login/parol bilan kiradi, har biri faqat
o'ziga ruxsat berilgan xonalarni ko'radi. Hammasi bitta serverda, Docker'da.

```
Brauzer ── https://cam.ttysi.uz ── Hestia proxy ──> http://172.16.0.23:3000
                                                          │
                                         ┌──────── gateway (nginx) ────────┐
                                         │ /         mehmon sahifa (ochiq) │
                                         │ /login …  Nuxt SPA (boshqaruv)  │
                                         │ /api      ──> service:4000      │
                                         │ /hls      jonli HLS (statik)    │
                                         │ /hls-pb   yozuv HLS (statik)    │
                                         └─────────────────────────────────┘
service  — API (SQLite): foydalanuvchilar, rollar, kameralar, NVR, playback, eksport
mediamtx — RTSP'ni tortadi, HLS segmentlarni ./hls ga yozadi
NVR      — Hikvision (ISAPI + RTSP): jonli oqim, yozuvlar, kamera sozlamalari
```

## Bo'limlar

| Bo'lim | Kim uchun | Nima qiladi |
|---|---|---|
| Jonli kuzatuv | `live.view` | Ruxsat etilgan xonalar, bino bo'yicha filtr, butun ekranga ochish |
| Yozuvlar | `playback.view` | Kun tanlash, 24 soatlik vaqt chizig'i, qayta ko'rish |
| Qirqib yuklab olish | `playback.export` | Boshlanish/Tugash belgilari → MP4 (kamera kodekida, aniq soniyadan) |
| Boshqaruv | admin ruxsatlari | Xodimlar, Kameralar (NVR), Kameralar ro'yxati, Xona guruhlari, Rollar, NVR qurilmalar, Kirishlar tarixi, Server holati |

- **Rollar va ruxsatlar** kengaytiriladi: yangi funksiya uchun `service/src/rbac.js`
  dagi `PERMISSIONS` ga kod qo'shiladi va u Rollar sahifasida paydo bo'ladi.
- **Kirishlar tarixi (audit)**: kirish, yozuv ko'rish, eksport va har bir boshqaruv amali.
- **Kameralar (NVR)**: NVR orqali kamera kodekini (H.264/H.265), o'lchamini, sifatini,
  kadr tezligini va Smart kodekni o'zgartirish. Saqlanganda kamera 1–2 daqiqa qayta
  ulanadi. Nom faqat saytda o'zgaradi.
- Sanalar hamma joyda **KK.OO.YYYY** ko'rinishida.

## Jonli oqim va kodek

- NVR kameralari **so'rov bo'yicha** yoqiladi: kimdir ko'rayotgan bo'lsa ochiladi,
  hech kim ko'rmay qo'ygach ~1 daqiqada o'chadi.
- Kamera **H.264** bersa — transkod yo'q (CPU ~0). **H.265** bersa — H.264 ga
  transkod (brauzerlar H.265 ni o'ynay olmaydi). Shuning uchun kameralarni H.264 ga
  o'tkazish tavsiya etiladi (Boshqaruv → Kameralar (NVR)).

## NVR talablari

- ISAPI yoqilgan (80-port), RTSP (554), server (172.16.0.23) dan ikkalasiga kirish ochiq.
- NVR'da **NTP va Asia/Tashkent** vaqt zonasi — aks holda yozuv vaqtlari siljiydi.
- Loyihaga alohida NVR foydalanuvchisi bering. Faqat ko'rish/yuklash uchun *Operator*
  yetarli; kamera sozlamalarini o'zgartirish uchun administrator huquqi kerak.

## Deploy (172.16.0.23)

```bash
cd kamera
cp .env.example .env     # parol va kalitlarni ALMASHTIRING
nano .env
docker compose up -d --build
```

Birinchi ishga tushishda `.env` dagi `ADMIN_USERNAME` / `ADMIN_PASSWORD` dan
superadmin yaratiladi (faqat bazada foydalanuvchi bo'lmasa). Keyin:
Boshqaruv → NVR qurilmalar → NVR qo'shish → kanallarni import → Xona guruhlari →
Xodimlar.

Lokal kompyuterda 3000-port band bo'lsa `.env` da `GATEWAY_PORT=3001` va
`STREAM_BASE=http://localhost:3001/hls`.

## Yangilash

```bash
git pull
docker compose up -d --build
```

## Fayl tuzilishi

```
kamera/
├── docker-compose.yml   # gateway :3000, service, mediamtx
├── .env.example         # muhit namunasi (.env git'ga tushmaydi)
├── mediamtx.yml         # MediaMTX: statik HLS + auth callback
├── gateway.conf         # nginx: SPA + /api proxy + /hls, /hls-pb statik
├── admin/               # Nuxt SPA (Docker ichida quriladi)
│   ├── pages/           # live, playback, nvr-cameras, users, roles, …
│   ├── components/      # HlsPlayer, DateInput, CameraForm
│   └── utils/date.ts    # KK.OO.YYYY formatlash
└── service/src/
    ├── rbac.js          # ruxsatlar, rollar, audit
    ├── hikvision.js     # NVR: ISAPI (digest), qidiruv, yuklab olish, oqim sozlamalari
    ├── live.js          # so'rov bo'yicha jonli oqim
    ├── playback.js      # ko'rish sessiyalari va MP4 eksport
    └── routes/          # API marshrutlari
```

Ish vaqtida yaratiladi (git'ga tushmaydi): `./data/` (kamera.db, eksportlar),
`./hls/`, `./hls-pb/`.

## API (tashqi tizimlar uchun)

`x-api-key: <SERVICE_API_KEY>` sarlavhasi bilan barcha API'lar to'liq huquqda:

- `GET /api/cameras` — kameralar (har birida `hls` URL)
- `POST /api/cameras`, `PUT /api/cameras/:id`, `DELETE /api/cameras/:id`

Ochiq (kalitsiz): `GET /api/public/cameras` — mehmon sahifadagi ochiq kameralar.
