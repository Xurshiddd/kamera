// Server holati sahifasi uchun: uptime, CPU yuki, RAM, disk va har bir
// kameraning jonli holati (MediaMTX'dan). Konteyner cgroup'siz ishlaydi,
// shuning uchun os.* qiymatlari HOST serverning o'zini ko'rsatadi.

import { Router } from "express";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import db from "../db.js";
import { requireAuth } from "../auth.js";

const execFileAsync = promisify(execFile);
const API = process.env.MEDIAMTX_API || "http://127.0.0.1:9997";

const router = Router();

// Ildiz FS — overlay bo'lsa ham host diskining o'zi (hajm/foydalanish bir xil).
async function diskUsage() {
  try {
    const { stdout } = await execFileAsync("df", ["-kP", "/"]);
    const parts = stdout.trim().split("\n").pop().split(/\s+/);
    return {
      total: Number(parts[1]) * 1024,
      used: Number(parts[2]) * 1024,
      free: Number(parts[3]) * 1024,
    };
  } catch {
    return null;
  }
}

// os.freemem() Linux'da MemFree — kesh hisobga olinmaydi va juda kichik
// ko'rinadi. Haqiqiy "bo'sh" — /proc/meminfo dagi MemAvailable.
async function memAvailable() {
  try {
    const text = await fs.readFile("/proc/meminfo", "utf8");
    const m = text.match(/MemAvailable:\s+(\d+) kB/);
    return m ? Number(m[1]) * 1024 : os.freemem();
  } catch {
    return os.freemem();
  }
}

router.get("/status", requireAuth, async (req, res) => {
  const [disk, memFree, pathsRes] = await Promise.all([
    diskUsage(),
    memAvailable(),
    fetch(`${API}/v3/paths/list?itemsPerPage=500`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  // MediaMTX'dagi jonli yo'llar: slug -> {ready, bytesReceived, readers, ...}
  const paths = new Map((pathsRes?.items || []).map((p) => [p.name, p]));

  const cameras = db
    .prepare("SELECT id, name, slug, codec FROM cameras ORDER BY name")
    .all()
    .map((c) => {
      const p = paths.get(c.slug);
      return {
        ...c,
        ready: Boolean(p?.ready), // oqim hozir jonlimi
        readers: p?.readers?.length || 0, // nechta tomoshabin ulangan
        bytesReceived: p?.bytesReceived || 0, // kameradan kelgan trafik
        since: p?.readyTime || null, // qachondan beri jonli
      };
    });

  res.json({
    server: {
      uptimeSec: os.uptime(), // host qancha ishlagan
      loadavg: os.loadavg(), // 1/5/15 daqiqalik CPU yuki
      cpus: os.cpus().length,
      memTotal: os.totalmem(),
      memFree,
    },
    serviceUptimeSec: process.uptime(),
    mediamtxOk: Boolean(pathsRes),
    disk,
    cameras,
  });
});

export default router;
