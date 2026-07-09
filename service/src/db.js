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

export default db;
