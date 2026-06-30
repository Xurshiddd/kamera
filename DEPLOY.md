# Deploy yo'riqnomasi

Ikki qism:
- **Hestia** — admin panel (static SPA) shu yerda turadi.
- **`.21` server (172.16.0.21)** — Docker (service + MediaMTX) va nginx.

```
Brauzer ─http─> Hestia /admin/         (static SPA)
        ─http─> 172.16.0.21/api/...    ─nginx→ docker :4000 (service)
        ─http─> 172.16.0.21/stream/... ─nginx→ docker :8888 (MediaMTX HLS)
```

> ⚠️ **Muhim:** Admin sahifa ham **HTTP** orqali ochilishi kerak. Agar Hestia
> domeni HTTPS bo'lsa, brauzer `http://172.16.0.21` so'rovini bloklaydi
> (mixed-content). Shuning uchun quyida admin domeni **HTTPS'siz** sozlanadi.

---

## A qism — `.21` server (172.16.0.21)

SSH bilan kiring: `ssh user@172.16.0.21`

### 1. Docker o'rnatish (agar yo'q bo'lsa)
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# keyin SSH'dan chiqib qayta kiring (guruh kuchga kirsin)
docker --version && docker compose version
```

### 2. Loyihaning `service/` papkasini serverga ko'chirish
O'z kompyuteringizdan:
```bash
scp -r service user@172.16.0.21:~/kamera-service
```
(yoki git bilan clone qiling)

### 3. `.env` ni sozlash
```bash
cd ~/kamera-service
nano .env
```
Quyidagilarni to'ldiring (maxfiy kalitlarni yangidan yarating):
```bash
SERVICE_API_KEY=<openssl rand -base64 32 natijasi>
JWT_SECRET=<boshqa: openssl rand -base64 32>
ADMIN_PASSWORD=<kuchli-parol>
ADMIN_ORIGIN=http://online.ttysi.uz   # admin HTTP orqali ochiladi
STREAM_BASE=http://172.16.0.21/stream
MEDIAMTX_API=http://127.0.0.1:9997
TOKEN_TTL_SECONDS=21600
DEFAULT_RTSP_PATH=Streaming/Channels/101
```
Kalit yaratish misoli: `openssl rand -base64 32`

### 4. Docker'ni ishga tushirish
```bash
docker compose up -d --build
docker compose ps                 # ikkala konteyner "running" bo'lsin
docker compose logs -f service    # "http://0.0.0.0:4000 da ishlamoqda"
```
Tekshiruv (shu serverning o'zida):
```bash
curl http://localhost:4000/health     # {"ok":true}
```

### 5. nginx o'rnatish va sozlash
```bash
sudo apt update && sudo apt install -y nginx
sudo cp ~/kamera-service/nginx/service-server.conf /etc/nginx/sites-available/kamera
sudo ln -s /etc/nginx/sites-available/kamera /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 6. Firewall (agar ufw yoqilgan bo'lsa)
```bash
sudo ufw allow 80/tcp     # faqat nginx :80 tashqariga kerak
# :4000 va :8888 to'g'ridan ochilishi shart emas (hammasi nginx orqali)
```

### 7. nginx orqali tekshirish
```bash
curl http://172.16.0.21/api/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"password":"<ADMIN_PASSWORD>"}'        # {"token":"..."}
```
Agar token qaytsa — `.21` tomoni to'liq tayyor. ✅

---

## B qism — Hestia (admin panel)

### 1. Static fayllarni tayyorlash (o'z kompyuteringizda)
```bash
cd admin
# .env: NUXT_PUBLIC_SERVICE_BASE=http://172.16.0.21  (allaqachon shunday)
npm run generate
```
Natija: `admin/.output/public/` — ichida `index.html`, `_nuxt/`, `login/`, `add/`.

### 2. Hestia'da web-domen
Hestia panel → **WEB → Add Web Domain** → masalan `online.ttysi.uz`.

### 3. ⚠️ HTTPS'ni O'CHIRISH (mixed-content uchun shart)
Domen sozlamasida:
- **SSL Support** — yoqMANG (yoki yoqilgan bo'lsa o'chiring).
- **Force HTTPS** / HSTS — o'chiq bo'lsin.

Shunda admin `http://online.ttysi.uz` da ochiladi va `http://172.16.0.21` ga
bemalol ulanadi.

### 4. Fayllarni `admin` papkaga yuklash
Admin SPA `/admin/` yo'lida turadi, shuning uchun fayllar `public_html/admin/`
ichiga tushadi. `public/` **ichidagi hammasini** ko'chiring:

SCP bilan:
```bash
# o'z kompyuteringizdan (Hestia user va domeningizni qo'ying)
scp -r admin/.output/public/* \
  hestia_user@HESTIA_IP:/home/hestia_user/web/online.ttysi.uz/public_html/admin/
```
Yoki Hestia **File Manager** orqali `public_html/admin/` papka yaratib, ichiga
`public/` mazmunini yuklang.

Natijada shunday bo'lishi kerak:
```
public_html/admin/index.html
public_html/admin/_nuxt/...
public_html/admin/login/index.html
public_html/admin/add/index.html
```

### 5. Ochib tekshirish
Brauzerda: `http://online.ttysi.uz/admin/`
- Login sahifasi chiqadi → `ADMIN_PASSWORD` bilan kiring.
- Kameralar ro'yxati yuklansa — hammasi ishlayapti. ✅

---

## Nimani qachon qayta qilish kerak

| O'zgarish | Nima qilinadi |
|---|---|
| service kodi yoki `.env` | `.21`: `docker compose up -d --build` |
| nginx config | `.21`: `sudo nginx -t && sudo systemctl reload nginx` |
| admin kodi | kompyuter: `npm run generate` → fayllarni Hestia'ga qayta yuklash |
| `NUXT_PUBLIC_SERVICE_BASE` (IP) | admin `.env` → `generate` → qayta yuklash (IP HTMLga baked) |

## Tez-tez uchraydigan xatolar
- **Login ishlamaydi / "blocked" konsولda** → admin HTTPS'da ochilgan. Domen
  HTTPS'ini o'chiring (B-3) yoki HSTS keshini tozalang.
- **CORS xatosi** → service `.env` dagi `ADMIN_ORIGIN` admin manzili bilan
  **aniq** mos kelishi kerak (scheme+host, oxirida `/` yo'q). O'zgartirsangiz
  `docker compose up -d` bilan qayta yuklang.
- **502 Bad Gateway** → docker ishlamayapti yoki port noto'g'ri.
  `docker compose ps`, `docker compose logs service`.
- **Oqim ko'rinmaydi** → `STREAM_BASE=http://172.16.0.21/stream` to'g'rimi va
  MediaMTX konteyneri ishlayaptimi tekshiring.
