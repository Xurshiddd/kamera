import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// DB — yagona haqiqat manbai. MediaMTX'dagi yo'llar qayta ishga tushganda
// yo'qoladi, shuning uchun haqiqiy ro'yxat shu yerda saqlanadi.
//
// Fayl DATA_DIR ichida saqlanadi. Docker'da bu katalog volume'ga ulanadi
// (docker-compose: ./data:/app/data), shuning uchun konteyner qayta
// ishga tushsa ham kamera.db yo'qolmaydi.
const DATA_DIR = process.env.DATA_DIR || "data";
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "kamera.db"));
// WAL rejimi Docker Desktop (Windows) bind-mount'da ishonchsiz: yozuvlar -wal
// fayliga tushib, asosiy faylga to'g'ri checkpoint bo'lmaydi va konteyner
// restartida yo'qoladi (o'chirilgan kamera "qaytib keladi"). Kam yozuvli bu
// loyiha uchun oddiy DELETE jurnali ishonchliroq.
db.pragma("journal_mode = DELETE");

db.exec(`
  CREATE TABLE IF NOT EXISTS cameras (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    ip         TEXT NOT NULL,
    port       INTEGER NOT NULL DEFAULT 554,
    login      TEXT NOT NULL,
    parol      TEXT NOT NULL,
    rtsp_path  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migratsiya: `codec` ustuni keyin qo'shildi (h264 / hevc). ffprobe bilan
// aniqlanadi va shunga qarab transkod qilinadi yoki to'g'ridan uzatiladi.
const cols = db.prepare("PRAGMA table_info(cameras)").all().map((c) => c.name);
if (!cols.includes("codec")) {
  db.exec("ALTER TABLE cameras ADD COLUMN codec TEXT");
}

// Migratsiya: `sort_order` — kamera ro'yxatda nechanchi bo'lib chiqishi.
// NULL bo'lsa tartib berilganlardan KEYIN (id bo'yicha) joylashadi.
if (!cols.includes("sort_order")) {
  db.exec("ALTER TABLE cameras ADD COLUMN sort_order INTEGER");
}

// Kamera ochiq (mehmon sahifasida ko'rinadi) yoki faqat login bilan.
// Mavjud kameralar avvalgidek ochiq qoladi (default 1).
if (!cols.includes("is_public")) {
  db.exec("ALTER TABLE cameras ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1");
}

// NVR orqali ulanish: nvr_id bo'lsa manba = NVR kanali (jonli + playback),
// bo'lmasa avvalgidek to'g'ridan kamera (orqaga mos).
if (!cols.includes("nvr_id")) {
  db.exec("ALTER TABLE cameras ADD COLUMN nvr_id INTEGER");
  db.exec("ALTER TABLE cameras ADD COLUMN channel INTEGER");
  db.exec("ALTER TABLE cameras ADD COLUMN stream TEXT NOT NULL DEFAULT 'main'");
}

db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS nvrs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    ip         TEXT NOT NULL,
    http_port  INTEGER NOT NULL DEFAULT 80,
    rtsp_port  INTEGER NOT NULL DEFAULT 554,
    login      TEXT NOT NULL,
    parol      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --- Foydalanuvchilar, rollar, ruxsatlar (RBAC) + audit ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    full_name     TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    system      INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS permissions (
    code        TEXT PRIMARY KEY,
    description TEXT
  );
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id   INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    perm_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role_id, perm_code)
  );
  CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  );
  CREATE TABLE IF NOT EXISTS camera_groups (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS camera_group_items (
    group_id  INTEGER NOT NULL REFERENCES camera_groups(id) ON DELETE CASCADE,
    camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, camera_id)
  );
  CREATE TABLE IF NOT EXISTS user_camera_groups (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES camera_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, group_id)
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    username   TEXT,
    action     TEXT NOT NULL,
    camera_id  INTEGER,
    details    TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log(created_at);
`);

export default db;
