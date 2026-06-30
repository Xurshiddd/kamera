# Kameralarni global sitega chiqarish

Loyiha **2 qism**ga bo'lingan:

```
kamera/
├── service/   # SERVERDA turadi: MediaMTX + backend API + DB
└── admin/     # Nuxt panel: server IP'siga ulanib kameralarni boshqaradi
```

## Qanday ishlaydi

1. Admin panelda kamera (nom, IP, login, parol) qo'shiladi.
2. Panel buni **service**ga yuboradi (server IP orqali).
3. Service kamerani DB'ga yozadi va MediaMTX'ga "shu RTSP'ni tort" deydi.
4. Service tashqi URL qaytaradi: `https://stream.../kamera-1/index.m3u8?token=...`
5. Boshqa platformalar shu URL bilan oqimni o'ynatadi. **Login/parol tashqariga chiqmaydi.**

Himoya: har bir ko'rish urinishida MediaMTX service'dan token tekshiradi. Token qisqa muddatli (default 60s).

---

## 1-qism: Service (serverda)

Server — kameralar bilan bir tarmoqdagi kompyuter.

```bash
cd service
cp .env.example .env        # kalitlarni ALMASHTIRING
# Docker bilan (MediaMTX ham birga ko'tariladi):
docker compose up -d
```

Yoki Docker'siz (MediaMTX'ni alohida o'rnatib):

```bash
cd service
npm install
node src/index.js           # http://0.0.0.0:4000
```

`.env` dagi muhim qiymatlar:

- `SERVICE_API_KEY` — admin panel bilan bir xil bo'lishi shart
- `JWT_SECRET` — token imzosi (boshqa, uzun, tasodifiy)
- `STREAM_BASE` — tashqi domen (Cloudflare Tunnel / domeningiz)

## 2-qism: Admin panel (Nuxt)

Panel istalgan joyda ishlashi mumkin — u serverga **IP orqali** ulanadi.

```bash
cd admin
npm install
cp .env.example .env        # NUXT_PUBLIC_SERVICE_BASE = http://SERVER-IP:4000
npm run dev                 # http://localhost:3000
```

`.env`:

- `NUXT_PUBLIC_SERVICE_BASE` — serverdagi service manzili (masalan `http://192.168.1.50:4000`)
- `NUXT_SERVICE_API_KEY` — service'dagi `SERVICE_API_KEY` bilan bir xil
- `NUXT_ADMIN_PASSWORD` — panelga kirish paroli (panel ochilganda so'raladi)
- `NUXT_SESSION_SECRET` — kirish cookie'sini imzolash kaliti (uzun, tasodifiy)

API kalit faqat Nuxt serverida ishlatiladi (brauzerga chiqmaydi) — panel o'zining
`/api/...` route'lari orqali service'ga proxy qiladi.

### Panelga kirish (auth)

Panel parol bilan himoyalangan. Ochilganda login sahifasi chiqadi; `NUXT_ADMIN_PASSWORD`
to'g'ri kiritilsa 7 kunlik imzolangan cookie beriladi. Parol va imzo kaliti faqat Nuxt
serverida turadi — brauzerga chiqmaydi. Kamera API route'lari ham server tomonda
tekshiriladi, shuning uchun to'g'ridan-to'g'ri so'rov ham parolsiz o'tmaydi. Yuqori o'ng
burchakdagi "Chiqish" tugmasi cookie'ni o'chiradi.

---

## Internetga chiqarish

Server NAT ortida bo'lsa, **Cloudflare Tunnel** tavsiya etiladi (router sozlash shart emas,
HTTPS avtomatik). Tunnel orqali:

- MediaMTX HLS porti `:8888` → `stream.institut.uz`
- Service porti `:4000` → `service.institut.uz` (agar panel tashqaridan ulansa)

`STREAM_BASE` va `NUXT_PUBLIC_SERVICE_BASE`ni shu domenlarga qo'ying.

## Keyingi qadamlar

- Kamera brendi Hikvision/Dahua bo'lsa RTSP yo'li avtomatik. Boshqasi bo'lsa "qo'lda" tanlang.
- WebRTC (<1s kechikish) kerak bo'lsa, alohida TURN server qo'shiladi.
- ~~Panelga login (auth) qo'shish~~ — ✅ bajarildi (parol + imzolangan cookie).
- Foydalanuvchilar ko'p bo'lsa: bitta umumiy parol o'rniga foydalanuvchi nomi/parol va rollar.
