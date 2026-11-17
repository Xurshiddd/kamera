import { Router } from "express";
import db from "../db.js";
import { requirePerm } from "../auth.js";
import { audit } from "../rbac.js";
import { collect, analyze } from "../topoInfer.js";

// Tarmoq sxemasi: router -> switch -> switch ... -> kameralar.
// Switchlar boshqarilmaydigan (SNMP/veb-panel yo'q), shuning uchun kim qayerga
// ulangani avtomatik aniqlanmaydi — xodim kiritadi, sxema avtomatik chiziladi.
const router = Router();

const KINDS = ["router", "switch", "poe_switch", "nvr", "other"];

// Bitta jismoniy kamera bir nechta NVR orqali qo'shilgan bo'lishi mumkin
// (cameras'da 2 ta qator, bir xil cam_ip). Sxemada u bitta: IP bo'yicha
// guruhlaymiz, havola guruhdagi istalgan id'da saqlangan bo'lishi mumkin.
function listCameras() {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, COALESCE(c.cam_ip, c.ip) AS ip, n.name AS nvr,
              l.device_id, l.port
       FROM cameras c
       LEFT JOIN nvrs n ON n.id = c.nvr_id
       LEFT JOIN camera_links l ON l.camera_id = c.id
       ORDER BY c.id`
    )
    .all();
  const byIp = new Map();
  for (const r of rows) {
    const g = byIp.get(r.ip);
    if (!g) {
      byIp.set(r.ip, { id: r.id, ids: [r.id], name: r.name, ip: r.ip, nvrs: r.nvr ? [r.nvr] : [], device_id: r.device_id, port: r.port });
    } else {
      g.ids.push(r.id);
      if (r.nvr && !g.nvrs.includes(r.nvr)) g.nvrs.push(r.nvr);
      if (g.device_id == null && r.device_id != null) {
        g.device_id = r.device_id;
        g.port = r.port;
      }
    }
  }
  return [...byIp.values()];
}

function listDevices() {
  return db
    .prepare(
      `SELECT id, name, kind, model, ip, location, ports, parent_id, parent_port, uplink_port, note
       FROM net_devices ORDER BY id`
    )
    .all();
}

const intOrNull = (v, max = 10000) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
};
const strOrNull = (v, max = 200) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length > max) return undefined;
  return t || null;
};

// parent_id qurilmaning o'zi yoki uning avlodi bo'lmasin (aylana bo'lmasin).
function createsCycle(id, parentId) {
  let cur = parentId;
  const seen = new Set();
  while (cur != null) {
    if (cur === id || seen.has(cur)) return true;
    seen.add(cur);
    cur = db.prepare("SELECT parent_id FROM net_devices WHERE id = ?").get(cur)?.parent_id ?? null;
  }
  return false;
}

function parseDevice(body, id = null) {
  const b = body || {};
  const name = strOrNull(b.name, 100);
  if (!name) return { error: "Qurilma nomi kerak" };
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) return { error: "Qurilma turi noto'g'ri" };
  const d = {
    name,
    kind,
    model: strOrNull(b.model, 100),
    ip: strOrNull(b.ip, 64),
    location: strOrNull(b.location, 200),
    ports: intOrNull(b.ports, 512),
    parent_id: intOrNull(b.parent_id, Number.MAX_SAFE_INTEGER),
    parent_port: intOrNull(b.parent_port, 512),
    uplink_port: intOrNull(b.uplink_port, 512),
    note: strOrNull(b.note, 500),
  };
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) return { error: `Noto'g'ri qiymat: ${k}` };
  }
  if (d.parent_id != null) {
    if (!db.prepare("SELECT 1 FROM net_devices WHERE id = ?").get(d.parent_id)) {
      return { error: "Ota qurilma topilmadi" };
    }
    if (id != null && createsCycle(id, d.parent_id)) {
      return { error: "Qurilma o'zining ichidagi qurilmaga ulanolmaydi (aylana)" };
    }
  } else {
    d.parent_port = null;
  }
  return { d };
}

// Qurilmaga ulangan kameralarni to'liq almashtirish: [{camera_id, port}].
// Boshqa switchda turgan kamera shu yerga ko'chadi (kamera bitta joyda bo'ladi).
function setCameras(deviceId, cams) {
  const groups = listCameras();
  const groupOf = new Map();
  for (const g of groups) for (const i of g.ids) groupOf.set(i, g);

  const del = db.prepare("DELETE FROM camera_links WHERE camera_id = ?");
  db.prepare("DELETE FROM camera_links WHERE device_id = ?").run(deviceId);
  const ins = db.prepare("INSERT INTO camera_links (camera_id, device_id, port) VALUES (?, ?, ?)");
  for (const c of cams) {
    const g = groupOf.get(Number(c?.camera_id));
    if (!g) continue;
    for (const i of g.ids) del.run(i);
    const port = intOrNull(c.port, 512);
    ins.run(g.id, deviceId, port === undefined ? null : port);
  }
}

router.get("/", requirePerm("topology.view", "topology.manage"), (req, res) => {
  res.json({ devices: listDevices(), cameras: listCameras(), kinds: KINDS });
});

router.post("/devices", requirePerm("topology.manage"), (req, res) => {
  const { d, error } = parseDevice(req.body);
  if (error) return res.status(400).json({ error });
  let id;
  db.transaction(() => {
    id = db
      .prepare(
        `INSERT INTO net_devices (name, kind, model, ip, location, ports, parent_id, parent_port, uplink_port, note)
         VALUES (@name, @kind, @model, @ip, @location, @ports, @parent_id, @parent_port, @uplink_port, @note)`
      )
      .run(d).lastInsertRowid;
    if (Array.isArray(req.body?.cameras)) setCameras(id, req.body.cameras);
  })();
  audit(req, "topology.device.create", { details: { id, name: d.name } });
  res.status(201).json({ id });
});

router.put("/devices/:id(\\d+)", requirePerm("topology.manage"), (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM net_devices WHERE id = ?").get(id)) {
    return res.status(404).json({ error: "Topilmadi" });
  }
  const { d, error } = parseDevice(req.body, id);
  if (error) return res.status(400).json({ error });
  db.transaction(() => {
    db.prepare(
      `UPDATE net_devices SET name=@name, kind=@kind, model=@model, ip=@ip, location=@location, ports=@ports,
         parent_id=@parent_id, parent_port=@parent_port, uplink_port=@uplink_port, note=@note WHERE id=@id`
    ).run({ ...d, id });
    if (Array.isArray(req.body?.cameras)) setCameras(id, req.body.cameras);
  })();
  audit(req, "topology.device.update", { details: { id, name: d.name } });
  res.json({ ok: true });
});

router.delete("/devices/:id(\\d+)", requirePerm("topology.manage"), (req, res) => {
  const row = db.prepare("SELECT id, name FROM net_devices WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  // Bolalar (ichki switchlar) ON DELETE SET NULL bilan ildizga chiqadi,
  // kameralar esa "ulanmagan" bo'lib qoladi (camera_links CASCADE).
  db.prepare("DELETE FROM net_devices WHERE id = ?").run(row.id);
  audit(req, "topology.device.delete", { details: row });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
//  NVR jurnalidan switch'larni taxmin qilish (fonda, bir vaqtda bitta).
//  NVR'da hech narsa o'zgarmaydi — faqat jurnal o'qiladi.
// ---------------------------------------------------------------------------
let job = null;
let lastResult = null;

const publicJob = (j) =>
  j && {
    id: j.id,
    running: j.running,
    step: j.step,
    nvrs: j.nvrs,
    error: j.error,
    started_at: j.started_at,
    finished_at: j.finished_at,
  };

router.get("/infer", requirePerm("topology.manage"), (req, res) => {
  res.json({ job: publicJob(job), result: lastResult });
});

router.post("/infer", requirePerm("topology.manage"), (req, res) => {
  if (job?.running) return res.status(409).json({ error: "Tahlil hali davom etmoqda" });
  const nvrs = db.prepare("SELECT * FROM nvrs ORDER BY id").all();
  job = {
    id: Date.now().toString(36),
    running: true,
    step: "Boshlanmoqda…",
    nvrs: nvrs.map((n) => ({ id: n.id, name: n.name, ip: n.ip, state: "queued", days: 0, total: 0, added: 0, error: null })),
    error: null,
    started_at: new Date().toISOString(),
    finished_at: null,
  };
  const j = job;
  audit(req, "topology.infer");
  res.status(202).json(publicJob(j));

  (async () => {
    for (const nvr of nvrs) {
      const st = j.nvrs.find((x) => x.id === nvr.id);
      st.state = "running";
      j.step = `${nvr.name}: jurnal o'qilmoqda…`;
      try {
        st.added = await collect(nvr, {
          onDay: (i, total, day) => {
            st.days = i;
            st.total = total;
            j.step = `${nvr.name}: ${day} (${i}/${total})`;
          },
        });
        st.state = "ok";
      } catch (e) {
        st.state = "error";
        st.error = e?.cause?.code === "UND_ERR_CONNECT_TIMEOUT" || /fetch failed|timeout|aborted/i.test(e.message) ? "NVR javob bermadi (tarmoqda yo'q)" : e.message;
      }
    }
    j.step = "Tahlil qilinmoqda…";
    try {
      lastResult = { ...analyze(), at: new Date().toISOString() };
    } catch (e) {
      j.error = `Tahlil xatosi: ${e.message}`;
    }
  })()
    .catch((e) => {
      j.error = e.message;
    })
    .finally(() => {
      j.running = false;
      j.finished_at = new Date().toISOString();
      j.step = j.error ? "Xatolik" : "Tayyor";
    });
});

export default router;
