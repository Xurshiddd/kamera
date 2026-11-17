<script setup lang="ts">
definePageMeta({ permission: ["topology.view", "topology.manage"] });

// Tarmoq sxemasi: router -> asosiy switch -> switchlar -> kameralar.
// Switchlar boshqarilmaydigan, shuning uchun ulanishlar qo'lda kiritiladi —
// sxema esa shu ma'lumotdan avtomatik chiziladi (SVG, yuklab olsa bo'ladi).
type Kind = "router" | "switch" | "poe_switch" | "nvr" | "other";
interface Dev {
  id: number;
  name: string;
  kind: Kind;
  model: string | null;
  ip: string | null;
  location: string | null;
  ports: number | null;
  parent_id: number | null;
  parent_port: number | null;
  uplink_port: number | null;
  note: string | null;
}
interface Cam { id: number; ids: number[]; name: string; ip: string; nvrs: string[]; device_id: number | null; port: number | null }

const { call } = useApi();
const { can } = useAuth();
const canEdit = computed(() => can("topology.manage"));

const devices = ref<Dev[]>([]);
const cameras = ref<Cam[]>([]);
const loading = ref(true);
const error = ref("");

const KIND_LABEL: Record<Kind, string> = {
  router: "Router",
  switch: "Switch",
  poe_switch: "PoE switch",
  nvr: "NVR",
  other: "Boshqa",
};
const KIND_COLOR: Record<Kind, string> = {
  router: "#6d28d9",
  switch: "#1d4ed8",
  poe_switch: "#0f766e",
  nvr: "#b45309",
  other: "#4b5563",
};

async function reload() {
  loading.value = true;
  error.value = "";
  try {
    const r = await call<{ devices: Dev[]; cameras: Cam[] }>("/api/topology");
    devices.value = r.devices;
    cameras.value = r.cameras;
  } catch {
    error.value = "Ma'lumotlarni olib bo'lmadi.";
  } finally {
    loading.value = false;
  }
}
onMounted(reload);

const devById = computed(() => new Map(devices.value.map((d) => [d.id, d])));
const childrenOf = computed(() => {
  const m = new Map<number | null, Dev[]>();
  for (const d of devices.value) {
    const p = d.parent_id != null && devById.value.has(d.parent_id) ? d.parent_id : null;
    if (!m.has(p)) m.set(p, []);
    m.get(p)!.push(d);
  }
  // Port raqami bo'yicha tartib — sxemada switchdagi joylashuvga yaqin.
  for (const list of m.values()) list.sort((a, b) => (a.parent_port ?? 999) - (b.parent_port ?? 999) || a.id - b.id);
  return m;
});
const camsOf = computed(() => {
  const m = new Map<number, Cam[]>();
  for (const c of cameras.value) {
    if (c.device_id == null) continue;
    if (!m.has(c.device_id)) m.set(c.device_id, []);
    m.get(c.device_id)!.push(c);
  }
  for (const list of m.values()) list.sort((a, b) => (a.port ?? 999) - (b.port ?? 999) || a.name.localeCompare(b.name));
  return m;
});
const unlinked = computed(() => cameras.value.filter((c) => c.device_id == null || !devById.value.has(c.device_id)));

function usedPorts(d: Dev) {
  return (camsOf.value.get(d.id)?.length || 0) + (childrenOf.value.get(d.id)?.length || 0) + (d.parent_id != null ? 1 : 0);
}

// ---------------------------------------------------------------------------
//  Sxema joylashuvi (yuqoridan pastga daraxt)
// ---------------------------------------------------------------------------
const DEV_W = 236;
const DEV_H = 92;
const CAM_W = 132;
const CAM_H = 92;
const CAM_GAP = 12;
const MAX_COLS = 6;
const BUS = 30; // har bir kamera qatori ustidagi sim balandligi
const PAD = 16;
const HGAP = 44;
const VGAP = 76;
const MARGIN = 24;

interface NodeBox {
  dev: Dev;
  x: number; // ramka chap-yuqori
  y: number;
  w: number;
  h: number;
  box: { x: number; y: number };
  cams: { cam: Cam; x: number; y: number }[];
  wires: string[]; // kamera simlari (path d)
}
interface Link { d: string; label: string; lx: number; ly: number }

const layout = computed(() => {
  const nodes: NodeBox[] = [];
  const links: Link[] = [];

  const measure = new Map<number, { frameW: number; frameH: number; width: number; childW: number }>();
  const visiting = new Set<number>();
  function size(d: Dev): number {
    if (measure.has(d.id)) return measure.get(d.id)!.width;
    visiting.add(d.id);
    const n = camsOf.value.get(d.id)?.length || 0;
    const cols = Math.min(n, MAX_COLS);
    const rows = Math.ceil(n / MAX_COLS);
    const camW = cols ? cols * CAM_W + (cols - 1) * CAM_GAP : 0;
    const frameW = Math.max(DEV_W, camW) + PAD * 2;
    const frameH = PAD + DEV_H + rows * (BUS + CAM_H) + PAD;
    const kids = (childrenOf.value.get(d.id) || []).filter((k) => !visiting.has(k.id));
    const childW = kids.reduce((s, k) => s + size(k), 0) + Math.max(0, kids.length - 1) * HGAP;
    const width = Math.max(frameW, childW);
    measure.set(d.id, { frameW, frameH, width, childW });
    visiting.delete(d.id);
    return width;
  }

  function place(d: Dev, x: number, y: number) {
    const m = measure.get(d.id)!;
    const fx = x + (m.width - m.frameW) / 2;
    const cams = camsOf.value.get(d.id) || [];
    const innerW = m.frameW - PAD * 2;
    const box = { x: fx + PAD + (innerW - DEV_W) / 2, y: y + PAD };
    const cols = Math.min(cams.length, MAX_COLS);
    const camW = cols ? cols * CAM_W + (cols - 1) * CAM_GAP : 0;
    const gx = fx + PAD + (innerW - camW) / 2;
    const placed: NodeBox["cams"] = [];
    const wires: string[] = [];
    const cx = box.x + DEV_W / 2;
    const boxBottom = box.y + DEV_H;
    if (cams.length) {
      const rows = Math.ceil(cams.length / MAX_COLS);
      const trunkX = gx - 7;
      const lastBus = boxBottom + (rows - 1) * (BUS + CAM_H) + BUS / 2;
      wires.push(`M${cx} ${boxBottom} V${boxBottom + BUS / 2 - 6} H${trunkX} V${lastBus}`);
      cams.forEach((cam, i) => {
        const r = Math.floor(i / MAX_COLS);
        const c = i % MAX_COLS;
        const tx = gx + c * (CAM_W + CAM_GAP);
        const ty = boxBottom + r * (BUS + CAM_H) + BUS;
        placed.push({ cam, x: tx, y: ty });
      });
      for (let r = 0; r < rows; r++) {
        const busY = boxBottom + r * (BUS + CAM_H) + BUS / 2;
        const inRow = placed.slice(r * MAX_COLS, (r + 1) * MAX_COLS);
        const last = inRow[inRow.length - 1];
        wires.push(`M${trunkX} ${busY} H${last.x + CAM_W / 2}`);
        for (const p of inRow) wires.push(`M${p.x + CAM_W / 2} ${busY} V${p.y}`);
      }
    }
    nodes.push({ dev: d, x: fx, y, w: m.frameW, h: m.frameH, box, cams: placed, wires });

    const kids = (childrenOf.value.get(d.id) || []).filter((k) => measure.has(k.id));
    let kx = x + (m.width - m.childW) / 2;
    const ky = y + m.frameH + VGAP;
    const px = fx + m.frameW / 2;
    const py = y + m.frameH;
    for (const k of kids) {
      const kw = measure.get(k.id)!.width;
      const kcx = kx + kw / 2;
      const midY = py + VGAP / 2;
      links.push({
        d: `M${px} ${py} V${midY} H${kcx} V${ky}`,
        label: portLabel(k),
        lx: kcx,
        ly: ky - 14,
      });
      place(k, kx, ky);
      kx += kw + HGAP;
    }
  }

  const roots = childrenOf.value.get(null) || [];
  let x = MARGIN;
  let height = 0;
  for (const r of roots) {
    const w = size(r);
    place(r, x, MARGIN);
    x += w + HGAP * 2;
  }
  for (const n of nodes) height = Math.max(height, n.y + n.h);
  return { nodes, links, width: Math.max(x - HGAP * 2 + MARGIN, 400), height: height + MARGIN };
});

function portLabel(d: Dev) {
  const a = d.parent_port != null ? `P${d.parent_port}` : "";
  const b = d.uplink_port != null ? `P${d.uplink_port}` : "";
  if (a && b) return `${a} → ${b}`;
  return a || b;
}
function cut(s: string | null | undefined, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// --- Masshtab ---
const zoom = ref(1);
const wrap = ref<HTMLElement | null>(null);
function fit() {
  const w = wrap.value?.clientWidth || 1000;
  zoom.value = Math.max(0.25, Math.min(1, (w - 4) / layout.value.width));
}
watch(() => layout.value.width, () => nextTick(fit));

// --- Yuklab olish / chop etish ---
const svgEl = ref<SVGSVGElement | null>(null);
function downloadSvg() {
  if (!svgEl.value) return;
  const clone = svgEl.value.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(layout.value.width));
  clone.setAttribute("height", String(layout.value.height));
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', clone.outerHTML], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "tarmoq-sxemasi.svg";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function printPage() {
  window.print();
}

// ---------------------------------------------------------------------------
//  Tahrirlash
// ---------------------------------------------------------------------------
const editing = ref<number | null>(null); // 0 = yangi
const form = reactive({
  name: "",
  kind: "switch" as Kind,
  model: "",
  ip: "",
  location: "",
  ports: "" as string | number,
  parent_id: null as number | null,
  parent_port: "" as string | number,
  uplink_port: "" as string | number,
  note: "",
  cams: [] as { camera_id: number; port: string | number }[],
});
const camQ = ref("");
const saving = ref(false);
const formError = ref("");
const formEl = ref<HTMLElement | null>(null);

function descendants(id: number) {
  const out = new Set<number>([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const k of childrenOf.value.get(cur) || []) {
      if (!out.has(k.id)) {
        out.add(k.id);
        stack.push(k.id);
      }
    }
  }
  return out;
}
const parentOptions = computed(() => {
  const banned = editing.value ? descendants(editing.value) : new Set<number>();
  return devices.value.filter((d) => !banned.has(d.id));
});

function openNew(parentId: number | null = null) {
  editing.value = 0;
  Object.assign(form, {
    name: "",
    kind: "switch",
    model: "",
    ip: "",
    location: "",
    ports: "",
    parent_id: parentId,
    parent_port: "",
    uplink_port: "",
    note: "",
    cams: [],
  });
  camQ.value = "";
  formError.value = "";
  nextTick(() => formEl.value?.scrollIntoView({ behavior: "smooth", block: "start" }));
}
function openEdit(d: Dev) {
  if (!canEdit.value) return;
  editing.value = d.id;
  Object.assign(form, {
    name: d.name,
    kind: d.kind,
    model: d.model || "",
    ip: d.ip || "",
    location: d.location || "",
    ports: d.ports ?? "",
    parent_id: d.parent_id,
    parent_port: d.parent_port ?? "",
    uplink_port: d.uplink_port ?? "",
    note: d.note || "",
    cams: (camsOf.value.get(d.id) || []).map((c) => ({ camera_id: c.id, port: c.port ?? "" })),
  });
  camQ.value = "";
  formError.value = "";
  nextTick(() => formEl.value?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

const camById = computed(() => new Map(cameras.value.map((c) => [c.id, c])));
const formCamIds = computed(() => new Set(form.cams.map((c) => c.camera_id)));
const camSearch = computed(() => {
  const s = camQ.value.trim().toLowerCase();
  if (!s) return [];
  return cameras.value
    .filter((c) => !formCamIds.value.has(c.id) && (c.name.toLowerCase().includes(s) || c.ip.includes(s)))
    .slice(0, 12);
});
function addCam(c: Cam) {
  // Keyingi bo'sh port taklif qilinadi.
  const used = new Set(form.cams.map((x) => Number(x.port)).filter(Boolean));
  if (form.uplink_port !== "") used.add(Number(form.uplink_port));
  let p = 1;
  while (used.has(p)) p++;
  const max = Number(form.ports) || 0;
  form.cams.push({ camera_id: c.id, port: !max || p <= max ? p : "" });
  camQ.value = "";
}
function addAllUnlinked() {
  for (const c of unlinked.value) if (!formCamIds.value.has(c.id)) addCam(c);
}
function removeCam(i: number) {
  form.cams.splice(i, 1);
}

// Port to'qnashuvlari (ogohlantirish, saqlashga to'sqinlik qilmaydi).
const portWarnings = computed(() => {
  const seen = new Map<number, string[]>();
  const add = (p: any, who: string) => {
    const n = Number(p);
    if (p === "" || p == null || !Number.isFinite(n)) return;
    if (!seen.has(n)) seen.set(n, []);
    seen.get(n)!.push(who);
  };
  if (form.parent_id != null) add(form.uplink_port, "ota qurilmaga ketuvchi port");
  for (const c of form.cams) add(c.port, camById.value.get(c.camera_id)?.name || `#${c.camera_id}`);
  if (editing.value) for (const k of childrenOf.value.get(editing.value) || []) add(k.parent_port, k.name);
  const out: string[] = [];
  const max = Number(form.ports) || 0;
  for (const [p, who] of seen) {
    if (who.length > 1) out.push(`P${p} ikki marta band: ${who.join(", ")}`);
    if (max && p > max) out.push(`P${p} — switchda faqat ${max} ta port bor`);
  }
  return out;
});

async function save() {
  formError.value = "";
  if (!form.name.trim()) return (formError.value = "Qurilma nomi kerak.");
  saving.value = true;
  const n = (v: any) => (v === "" || v == null ? null : Number(v));
  const body = {
    name: form.name,
    kind: form.kind,
    model: form.model,
    ip: form.ip,
    location: form.location,
    ports: n(form.ports),
    parent_id: form.parent_id,
    parent_port: n(form.parent_port),
    uplink_port: n(form.uplink_port),
    note: form.note,
    cameras: form.cams.map((c) => ({ camera_id: c.camera_id, port: n(c.port) })),
  };
  try {
    if (editing.value === 0) await call("/api/topology/devices", { method: "POST", body });
    else await call(`/api/topology/devices/${editing.value}`, { method: "PUT", body });
    editing.value = null;
    await reload();
  } catch (e: any) {
    formError.value = e?.data?.error || "Saqlab bo'lmadi.";
  } finally {
    saving.value = false;
  }
}

async function remove(d: Dev) {
  const k = childrenOf.value.get(d.id)?.length || 0;
  const c = camsOf.value.get(d.id)?.length || 0;
  if (!confirm(`"${d.name}" o'chirilsinmi?\n${c} ta kamera "ulanmagan" bo'lib qoladi${k ? `, ${k} ta ichki qurilma yuqoriga ko'tariladi` : ""}.`)) return;
  try {
    await call(`/api/topology/devices/${d.id}`, { method: "DELETE" });
    if (editing.value === d.id) editing.value = null;
    await reload();
  } catch (e: any) {
    alert(e?.data?.error || "Xatolik");
  }
}

// ---------------------------------------------------------------------------
//  NVR jurnalidan avtomatik aniqlash (taxmin)
// ---------------------------------------------------------------------------
interface IMember { key: string; camera_id: number | null; name: string; ip: string | null; device_id: number | null; outages: number; nvr?: string | null; channel?: number }
interface IGroup { confidence: number; outages: number; members: IMember[] }
interface ISuper extends IGroup { groups: IGroup[]; loose: IMember[] }
interface IResult { events: number; from: string | null; to: string | null; cameras: number; nvr_wide: number; supers: ISuper[]; ungrouped: IMember[]; at: string }
interface IJob {
  id: string;
  running: boolean;
  step: string;
  error: string | null;
  nvrs: { id: number; name: string; ip: string; state: string; days: number; total: number; added: number; error: string | null }[];
}
const infer = ref<{ job: IJob | null; result: IResult | null }>({ job: null, result: null });
const inferBusy = ref(false);
const inferMsg = ref("");
const doneGroups = ref(new Set<string>());
const superSwitch = ref(new Map<number, number>()); // super index -> yaratilgan yuqori switch id
const attachTo = reactive<Record<string, number | null>>({});
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const gKey = (g: IGroup) => g.members.map((m) => m.key).join(",");
const strength = (g: IGroup) => (g.outages >= 8 && g.confidence >= 40 ? "kuchli" : g.outages >= 4 && g.confidence >= 30 ? "oʻrtacha" : "kuchsiz");
const strengthCls = (g: IGroup) => ({ kuchli: "badge-ok", "oʻrtacha": "badge-warn", kuchsiz: "badge-muted" })[strength(g)];
// "YYYY-MM-DDTHH:MM:SS" -> "DD.MM.YYYY"
const dmy = (s: string | null) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "—");

async function loadInfer() {
  if (!canEdit.value) return;
  try {
    infer.value = await call("/api/topology/infer");
    if (infer.value.job?.running) pollTimer = setTimeout(loadInfer, 1500);
  } catch {}
}
onMounted(loadInfer);
onBeforeUnmount(() => pollTimer && clearTimeout(pollTimer));

async function startInfer() {
  inferMsg.value = "";
  try {
    await call("/api/topology/infer", { method: "POST" });
    doneGroups.value = new Set();
    superSwitch.value = new Map();
    await loadInfer();
  } catch (e: any) {
    inferMsg.value = e?.data?.error || "Boshlab boʻlmadi.";
  }
}

function autoName(members: IMember[], prefix = "SW (taxmin)") {
  const n = members.map((m) => m.name);
  return `${prefix}: ${n.slice(0, 3).join(", ")}${n.length > 3 ? "…" : ""}`.slice(0, 100);
}
const linkable = (members: IMember[]) => members.filter((m) => m.camera_id != null).map((m) => ({ camera_id: m.camera_id!, port: null }));

async function createDevice(name: string, parentId: number | null, members: IMember[]) {
  const r = await call<{ id: number }>("/api/topology/devices", {
    method: "POST",
    body: { name, kind: "switch", parent_id: parentId, note: "NVR jurnali boʻyicha taxmin — joyida tekshiring", cameras: linkable(members) },
  });
  return r.id;
}

async function addGroup(g: IGroup, si: number) {
  inferBusy.value = true;
  try {
    await createDevice(autoName(g.members), superSwitch.value.get(si) ?? null, g.members);
    doneGroups.value.add(gKey(g));
    await reload();
  } catch (e: any) {
    alert(e?.data?.error || "Saqlab boʻlmadi");
  } finally {
    inferBusy.value = false;
  }
}

async function attachGroup(g: IGroup) {
  const id = attachTo[gKey(g)];
  const d = id != null ? devById.value.get(id) : null;
  if (!d) return;
  inferBusy.value = true;
  try {
    const current = (camsOf.value.get(d.id) || []).map((c) => ({ camera_id: c.id, port: c.port }));
    const have = new Set(current.map((c) => c.camera_id));
    const add = linkable(g.members).filter((c) => !have.has(c.camera_id));
    await call(`/api/topology/devices/${d.id}`, { method: "PUT", body: { ...d, cameras: [...current, ...add] } });
    doneGroups.value.add(gKey(g));
    await reload();
  } catch (e: any) {
    alert(e?.data?.error || "Saqlab boʻlmadi");
  } finally {
    inferBusy.value = false;
  }
}

// Katta guruh: yuqori switch + ichidagi switchlar (ketma-ketlik bilan) bir bosishda.
async function addSuper(s: ISuper, si: number) {
  inferBusy.value = true;
  try {
    let parent = superSwitch.value.get(si) ?? null;
    const multi = s.groups.length + (s.loose.length ? 1 : 0) > 1;
    if (multi && parent == null) {
      parent = await createDevice(autoName(s.loose.length ? s.loose : s.members, "Yuqori SW (taxmin)"), null, s.loose);
      superSwitch.value.set(si, parent);
    }
    for (const g of s.groups) {
      if (doneGroups.value.has(gKey(g))) continue;
      await createDevice(autoName(g.members), multi ? parent : null, g.members);
      doneGroups.value.add(gKey(g));
    }
    doneGroups.value.add(gKey(s));
    await reload();
  } catch (e: any) {
    alert(e?.data?.error || "Saqlab boʻlmadi");
  } finally {
    inferBusy.value = false;
  }
}

function parentText(d: Dev) {
  if (d.parent_id == null) return "—";
  const p = devById.value.get(d.parent_id);
  return `${p?.name || "?"}${d.parent_port != null ? ` (P${d.parent_port})` : ""}`;
}
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h1>Tarmoq sxemasi</h1>
        <p class="sub">Qaysi switch qaysiga ulangan va har bir switchga qaysi kameralar (qaysi portga) ulangan.</p>
      </div>
      <div class="btns no-print">
        <button v-if="canEdit && editing === null" class="btn btn-primary" @click="openNew()">+ Switch / qurilma</button>
      </div>
    </div>

    <p v-if="loading" class="muted">Yuklanmoqda…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <template v-else>
      <!-- ===================== Sxema ===================== -->
      <div v-if="devices.length" class="panel diagram-panel">
        <div class="toolbar no-print">
          <div class="legend">
            <span v-for="(c, k) in KIND_COLOR" :key="k" class="lg"><i :style="{ background: c }" />{{ KIND_LABEL[k] }}</span>
            <span class="lg"><i class="lg-cam" />Kamera</span>
          </div>
          <div class="btns">
            <button class="btn btn-sm" title="Kichiklashtirish" @click="zoom = Math.max(0.25, +(zoom - 0.1).toFixed(2))">−</button>
            <span class="zoom">{{ Math.round(zoom * 100) }}%</span>
            <button class="btn btn-sm" title="Kattalashtirish" @click="zoom = Math.min(2, +(zoom + 0.1).toFixed(2))">+</button>
            <button class="btn btn-sm" @click="fit">Ekranga moslash</button>
            <button class="btn btn-sm" @click="downloadSvg">Rasm (SVG)</button>
            <button class="btn btn-sm" @click="printPage">Chop etish</button>
          </div>
        </div>
        <div ref="wrap" class="diagram-wrap">
          <svg
            ref="svgEl"
            xmlns="http://www.w3.org/2000/svg"
            :viewBox="`0 0 ${layout.width} ${layout.height}`"
            :width="layout.width * zoom"
            :height="layout.height * zoom"
            font-family="Inter, Segoe UI, Arial, sans-serif"
            role="img"
            aria-label="Tarmoq sxemasi"
          >
            <rect x="0" y="0" :width="layout.width" :height="layout.height" fill="#ffffff" />

            <!-- Switchlar orasidagi kabellar -->
            <g v-for="(l, i) in layout.links" :key="'l' + i">
              <path :d="l.d" fill="none" stroke="#1f2937" stroke-width="3" />
              <g v-if="l.label">
                <rect :x="l.lx - 34" :y="l.ly - 11" width="68" height="20" rx="10" fill="#fef3c7" stroke="#f59e0b" />
                <text :x="l.lx" :y="l.ly + 4" text-anchor="middle" font-size="12" font-weight="700" fill="#78350f">{{ l.label }}</text>
              </g>
            </g>

            <g v-for="n in layout.nodes" :key="n.dev.id">
              <!-- Switch va uning kameralari ramkasi -->
              <rect :x="n.x" :y="n.y" :width="n.w" :height="n.h" rx="14" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="6 5" />
              <path v-for="(w, i) in n.wires" :key="i" :d="w" fill="none" stroke="#16a34a" stroke-width="2" />

              <!-- Qurilma -->
              <g class="dev" :class="{ clickable: canEdit }" @click="openEdit(n.dev)">
                <title>{{ n.dev.name }}{{ n.dev.note ? " — " + n.dev.note : "" }}</title>
                <rect :x="n.box.x" :y="n.box.y" :width="DEV_W" :height="DEV_H" rx="10" :fill="KIND_COLOR[n.dev.kind]" />
                <!-- ikonka -->
                <g v-if="n.dev.kind === 'router'" :transform="`translate(${n.box.x + 12} ${n.box.y + 24})`" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round">
                  <rect x="0" y="18" width="40" height="16" rx="3" />
                  <path d="M10 18 L6 2 M30 18 L34 2" />
                  <circle cx="9" cy="26" r="1.6" fill="#fff" /><circle cx="16" cy="26" r="1.6" fill="#fff" />
                </g>
                <g v-else-if="n.dev.kind === 'nvr'" :transform="`translate(${n.box.x + 12} ${n.box.y + 26})`" fill="none" stroke="#fff" stroke-width="2.2">
                  <rect x="0" y="4" width="40" height="28" rx="3" />
                  <path d="M6 13 H26 M6 22 H26" />
                  <circle cx="33" cy="18" r="3" fill="#fff" />
                </g>
                <g v-else :transform="`translate(${n.box.x + 12} ${n.box.y + 30})`">
                  <rect x="0" y="0" width="40" height="26" rx="3" fill="none" stroke="#fff" stroke-width="2.2" />
                  <rect v-for="p in 4" :key="'a' + p" :x="4 + (p - 1) * 8.5" y="5" width="6" height="6" fill="#fff" />
                  <rect v-for="p in 4" :key="'b' + p" :x="4 + (p - 1) * 8.5" y="15" width="6" height="6" fill="#fff" />
                </g>
                <text :x="n.box.x + 64" :y="n.box.y + 26" font-size="16" font-weight="700" fill="#fff">{{ cut(n.dev.name, 18) }}</text>
                <text :x="n.box.x + 64" :y="n.box.y + 46" font-size="13" fill="#e0e7ff">{{ cut([KIND_LABEL[n.dev.kind], n.dev.model].filter(Boolean).join(" · "), 23) }}</text>
                <text :x="n.box.x + 64" :y="n.box.y + 64" font-size="13" fill="#fff">{{ n.dev.ip || "" }}</text>
                <text :x="n.box.x + 64" :y="n.box.y + 81" font-size="12" fill="#e5e7eb">{{ cut(n.dev.location, 24) }}</text>
                <text :x="n.box.x + DEV_W - 10" :y="n.box.y + 81" font-size="12" font-weight="700" fill="#fff" text-anchor="end">
                  {{ n.dev.ports ? `${usedPorts(n.dev)}/${n.dev.ports}` : `${camsOf.get(n.dev.id)?.length || 0} kam.` }}
                </text>
              </g>

              <!-- Kameralar -->
              <g v-for="p in n.cams" :key="p.cam.id" class="cam" :class="{ clickable: canEdit }" @click="openEdit(n.dev)">
                <title>{{ p.cam.name }} — {{ p.cam.ip }}{{ p.cam.nvrs.length ? " · " + p.cam.nvrs.join(", ") : "" }}</title>
                <rect :x="p.x" :y="p.y" :width="CAM_W" :height="CAM_H" rx="10" fill="#ffffff" stroke="#16a34a" stroke-width="1.5" />
                <!-- kamera ikonka -->
                <g :transform="`translate(${p.x + CAM_W / 2 - 18} ${p.y + 10})`" fill="#334155">
                  <rect x="0" y="4" width="26" height="14" rx="3" />
                  <path d="M26 8 L36 4 V18 L26 14 Z" />
                  <rect x="9" y="18" width="4" height="8" />
                  <circle cx="7" cy="11" r="3" fill="#93c5fd" />
                </g>
                <g v-if="p.cam.port != null">
                  <rect :x="p.x + 6" :y="p.y + 6" width="34" height="18" rx="9" fill="#dcfce7" stroke="#16a34a" />
                  <text :x="p.x + 23" :y="p.y + 19" text-anchor="middle" font-size="11" font-weight="700" fill="#14532d">P{{ p.cam.port }}</text>
                </g>
                <text :x="p.x + CAM_W / 2" :y="p.y + 56" text-anchor="middle" font-size="13" font-weight="700" fill="#111827">{{ cut(p.cam.name, 16) }}</text>
                <text :x="p.x + CAM_W / 2" :y="p.y + 74" text-anchor="middle" font-size="11.5" fill="#4b5563">{{ p.cam.ip }}</text>
              </g>
            </g>
          </svg>
        </div>
      </div>
      <div v-else class="panel empty">
        <strong>Hali sxema yo'q.</strong>
        <p class="muted">
          Avval eng yuqoridagi qurilmani (masalan router yoki asosiy switch) qo'shing, so'ng unga ulangan switchlarni
          ("Ota qurilma" maydoni orqali) va har bir switchga ulangan kameralarni kiriting. Sxema avtomatik chiziladi.
        </p>
        <button v-if="canEdit" class="btn btn-primary" @click="openNew()">+ Birinchi qurilma</button>
      </div>

      <!-- ===================== Avtomatik aniqlash ===================== -->
      <div v-if="canEdit" class="panel no-print infer">
        <div class="infer-head">
          <div>
            <h2>NVR jurnalidan avtomatik aniqlash</h2>
            <p class="muted small">
              Switch oʻchsa, unga ulangan hamma kameralar bir vaqtda uziladi. NVR jurnalidagi uzilishlar vaqtidan
              "doim birga uziladigan" kameralar topiladi — ular bitta switchda boʻlishi ehtimoli katta.
              Bu <strong>taxmin</strong>: qoʻshgandan soʻng joyida tekshirib, nom va portlarni toʻgʻrilang. NVRʼda hech narsa oʻzgarmaydi.
            </p>
          </div>
          <button class="btn btn-primary" :disabled="infer.job?.running" @click="startInfer">
            {{ infer.job?.running ? "Tahlil qilinmoqda…" : infer.result ? "Qayta tahlil qilish" : "Tahlilni boshlash" }}
          </button>
        </div>
        <p v-if="inferMsg" class="err">{{ inferMsg }}</p>

        <div v-if="infer.job && (infer.job.running || infer.job.nvrs.some((n) => n.error))" class="job">
          <p v-if="infer.job.running"><strong>{{ infer.job.step }}</strong> <span class="muted small">(birinchi marta 2–3 daqiqa, keyin faqat yangi kunlar)</span></p>
          <ul class="job-list">
            <li v-for="n in infer.job.nvrs" :key="n.id">
              <span class="badge" :class="{ 'badge-ok': n.state === 'ok', 'badge-danger': n.state === 'error', 'badge-warn': n.state === 'running', 'badge-muted': n.state === 'queued' }">
                {{ { ok: "tayyor", error: "xato", running: "oʻqilmoqda", queued: "navbatda" }[n.state] }}
              </span>
              {{ n.name }} <span class="mono muted small">{{ n.ip }}</span>
              <span v-if="n.state === 'running' && n.total" class="muted small"> — {{ n.days }}/{{ n.total }} kun</span>
              <span v-if="n.state === 'ok'" class="muted small"> — {{ n.added }} ta yangi yozuv</span>
              <span v-if="n.error" class="err small"> — {{ n.error }}</span>
            </li>
          </ul>
        </div>
        <p v-if="infer.job?.error" class="err">{{ infer.job.error }}</p>

        <template v-if="infer.result && !infer.job?.running">
          <p class="muted small">
            {{ dmy(infer.result.from) }} – {{ dmy(infer.result.to) }} oraligʻidagi {{ infer.result.events }} ta uzilish, {{ infer.result.cameras }} ta kamera tahlil qilindi.
            <template v-if="infer.result.nvr_wide">Hamma kamera birga uzilgan {{ infer.result.nvr_wide }} ta holat (NVR qayta yuklanishi kabi) hisobga olinmadi.</template>
          </p>
          <p v-if="!infer.result.supers.length" class="muted">Birga uziladigan guruhlar topilmadi — jurnalda yetarli maʼlumot yoʻq.</p>

          <div v-for="(s, si) in infer.result.supers" :key="si" class="super" :class="{ done: doneGroups.has(gKey(s)) }">
            <div class="super-head">
              <div>
                <strong>{{ s.groups.length + (s.loose.length ? 1 : 0) > 1 ? `Yuqori switch (taxmin) #${si + 1}` : `Switch (taxmin) #${si + 1}` }}</strong>
                <span class="muted small"> — {{ s.members.length }} kamera, birga uzilgan {{ s.outages }} marta</span>
                <span class="badge" :class="strengthCls(s)">{{ strength(s) }}</span>
              </div>
              <button v-if="!doneGroups.has(gKey(s))" class="btn btn-sm btn-primary" :disabled="inferBusy" @click="addSuper(s, si)">
                Hammasini sxemaga qoʻshish
              </button>
              <span v-else class="ok-text small">✓ qoʻshildi</span>
            </div>

            <div v-for="g in s.groups" :key="gKey(g)" class="grp" :class="{ done: doneGroups.has(gKey(g)) }">
              <div class="grp-meta">
                <span class="badge" :class="strengthCls(g)">{{ strength(g) }}</span>
                <span class="muted small">{{ g.members.length }} kamera · birga uzilgan {{ g.outages }} marta · oʻxshashlik {{ g.confidence }}%</span>
              </div>
              <div class="chips">
                <span v-for="m in g.members" :key="m.key" class="chip" :class="{ ghost: m.camera_id == null }" :title="m.camera_id == null ? 'Kameralar roʻyxatiga import qilinmagan (NVR kanali) — sxemaga qoʻshilmaydi' : `${m.outages} marta uzilgan`">
                  <strong>{{ m.name }}</strong> <span class="mono muted">{{ m.ip }}</span>
                  <span v-if="m.device_id != null && devById.get(m.device_id)" class="badge badge-muted">{{ devById.get(m.device_id)!.name }}</span>
                </span>
              </div>
              <div v-if="!doneGroups.has(gKey(g))" class="grp-actions">
                <button class="btn btn-sm" :disabled="inferBusy" @click="addGroup(g, si)">Yangi switch qilib qoʻshish</button>
                <template v-if="devices.length">
                  <span class="muted small">yoki</span>
                  <select v-model="attachTo[gKey(g)]" class="input input-sm">
                    <option :value="undefined" disabled>mavjud switchni tanlang…</option>
                    <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }}</option>
                  </select>
                  <button class="btn btn-sm" :disabled="inferBusy || attachTo[gKey(g)] == null" @click="attachGroup(g)">Unga qoʻshish</button>
                </template>
              </div>
              <span v-else class="ok-text small">✓ qoʻshildi</span>
            </div>

            <div v-if="s.loose.length" class="grp loose">
              <div class="grp-meta"><span class="muted small">Toʻgʻridan-toʻgʻri yuqori switchga ulangan boʻlishi mumkin:</span></div>
              <div class="chips">
                <span v-for="m in s.loose" :key="m.key" class="chip" :class="{ ghost: m.camera_id == null }">
                  <strong>{{ m.name }}</strong> <span class="mono muted">{{ m.ip }}</span>
                </span>
              </div>
            </div>
          </div>

          <p v-if="infer.result.ungrouped.length" class="muted small">
            {{ infer.result.ungrouped.length }} ta kamerani guruhlab boʻlmadi (birga uzilish holati kam yoki yoʻq) — ularni qoʻlda kiriting.
          </p>
          <p class="muted small">Xira (punktir) kameralar NVRʼda bor, lekin kameralar roʻyxatiga import qilinmagan — ular sxemaga tushmaydi.</p>
        </template>
      </div>

      <!-- ===================== Forma ===================== -->
      <form v-if="editing !== null" ref="formEl" class="panel no-print" @submit.prevent="save">
        <strong class="form-title">{{ editing === 0 ? "Yangi qurilma" : `Tahrirlash: ${form.name}` }}</strong>
        <div class="grid">
          <div>
            <label class="label">Nomi *</label>
            <input v-model="form.name" class="input" placeholder="masalan: SW-2 qavat (koridor)" maxlength="100" />
          </div>
          <div>
            <label class="label">Turi</label>
            <select v-model="form.kind" class="input">
              <option v-for="(l, k) in KIND_LABEL" :key="k" :value="k">{{ l }}</option>
            </select>
          </div>
          <div>
            <label class="label">Model</label>
            <input v-model="form.model" class="input" placeholder="masalan: DS-3E0310P-E" maxlength="100" />
          </div>
          <div>
            <label class="label">IP (bo'lsa)</label>
            <input v-model="form.ip" class="input mono" placeholder="—" maxlength="64" />
          </div>
          <div>
            <label class="label">Joylashuvi</label>
            <input v-model="form.location" class="input" placeholder="masalan: 2-qavat, server shkafi" maxlength="200" />
          </div>
          <div>
            <label class="label">Portlar soni</label>
            <input v-model="form.ports" class="input" type="number" min="1" max="512" placeholder="masalan: 8" />
          </div>
        </div>

        <div class="grid">
          <div>
            <label class="label">Ota qurilma (qaysi switchga ulangan)</label>
            <select v-model="form.parent_id" class="input">
              <option :value="null">— eng yuqori (hech qayerga) —</option>
              <option v-for="d in parentOptions" :key="d.id" :value="d.id">{{ d.name }}{{ d.location ? ` — ${d.location}` : "" }}</option>
            </select>
          </div>
          <div>
            <label class="label">Ota qurilmaning porti</label>
            <input v-model="form.parent_port" class="input" type="number" min="0" max="512" :disabled="form.parent_id == null" placeholder="masalan: 5" />
          </div>
          <div>
            <label class="label">Bu qurilmaning uplink porti</label>
            <input v-model="form.uplink_port" class="input" type="number" min="0" max="512" :disabled="form.parent_id == null" placeholder="masalan: 9" />
          </div>
        </div>

        <div>
          <label class="label">Izoh</label>
          <input v-model="form.note" class="input" maxlength="500" placeholder="ixtiyoriy" />
        </div>

        <div>
          <div class="cam-head">
            <label class="label">Ulangan kameralar ({{ form.cams.length }})</label>
            <div class="btns">
              <button v-if="unlinked.length" class="btn btn-sm" type="button" @click="addAllUnlinked">Ulanmaganlarning hammasini qo'shish ({{ unlinked.length }})</button>
            </div>
          </div>
          <div class="search">
            <input v-model="camQ" class="input" placeholder="Kamera nomi yoki IP bo'yicha qidirib qo'shing…" />
            <div v-if="camSearch.length" class="search-list">
              <button v-for="c in camSearch" :key="c.id" type="button" class="search-item" @click="addCam(c)">
                <span><strong>{{ c.name }}</strong> <span class="mono muted">{{ c.ip }}</span></span>
                <span v-if="c.device_id != null && devById.get(c.device_id)" class="badge badge-warn">hozir: {{ devById.get(c.device_id)!.name }}</span>
              </button>
            </div>
          </div>
          <div v-if="form.cams.length" class="table-wrap cams-table">
            <table class="table">
              <thead><tr><th>Port</th><th>Kamera</th><th>IP</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(c, i) in form.cams" :key="c.camera_id">
                  <td><input v-model="c.port" class="input port" type="number" min="0" max="512" placeholder="—" /></td>
                  <td>
                    {{ camById.get(c.camera_id)?.name }}
                    <span
                      v-if="camById.get(c.camera_id)?.device_id != null && camById.get(c.camera_id)?.device_id !== editing"
                      class="badge badge-warn"
                    >ko'chadi: {{ devById.get(camById.get(c.camera_id)!.device_id!)?.name }} dan</span>
                  </td>
                  <td class="mono">{{ camById.get(c.camera_id)?.ip }}</td>
                  <td class="end"><button class="btn btn-sm btn-danger" type="button" @click="removeCam(i)">Olib tashlash</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="muted small">Hali kamera biriktirilmagan.</p>
        </div>

        <ul v-if="portWarnings.length" class="warn-list">
          <li v-for="w in portWarnings" :key="w">⚠ {{ w }}</li>
        </ul>
        <p v-if="formError" class="err">{{ formError }}</p>
        <div class="actions">
          <button v-if="editing" class="btn btn-danger" type="button" @click="remove(devById.get(editing)!)">O'chirish</button>
          <span class="spacer" />
          <button class="btn" type="button" @click="editing = null">Bekor qilish</button>
          <button class="btn btn-primary" :disabled="saving" type="submit">{{ saving ? "Saqlanmoqda…" : "Saqlash" }}</button>
        </div>
      </form>

      <!-- ===================== Ro'yxat ===================== -->
      <div v-if="devices.length" class="panel no-print">
        <h2>Qurilmalar ({{ devices.length }})</h2>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>Nomi</th><th>Turi</th><th>IP</th><th>Joylashuvi</th><th>Ulangan joyi</th><th>Kameralar</th><th>Portlar</th><th v-if="canEdit"></th></tr>
            </thead>
            <tbody>
              <tr v-for="d in devices" :key="d.id">
                <td><strong>{{ d.name }}</strong><div v-if="d.note" class="muted small">{{ d.note }}</div></td>
                <td><span class="kind" :style="{ background: KIND_COLOR[d.kind] }">{{ KIND_LABEL[d.kind] }}</span></td>
                <td class="mono">{{ d.ip || "—" }}</td>
                <td>{{ d.location || "—" }}</td>
                <td>{{ parentText(d) }}</td>
                <td>{{ camsOf.get(d.id)?.length || 0 }}</td>
                <td>{{ d.ports ? `${usedPorts(d)} / ${d.ports} band` : "—" }}</td>
                <td v-if="canEdit" class="btns end">
                  <button class="btn btn-sm" @click="openNew(d.id)">+ Ichiga switch</button>
                  <button class="btn btn-sm" @click="openEdit(d)">Tahrirlash</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="cameras.length" class="panel">
        <h2>Switchga biriktirilmagan kameralar ({{ unlinked.length }})</h2>
        <p v-if="!unlinked.length" class="ok-text">Hamma kameralar sxemada.</p>
        <div v-else class="chips">
          <span v-for="c in unlinked" :key="c.id" class="chip" :title="c.nvrs.join(', ')">
            <strong>{{ c.name }}</strong> <span class="mono muted">{{ c.ip }}</span>
          </span>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.btns {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.end {
  justify-content: flex-end;
  text-align: right;
}
.diagram-panel {
  padding: 12px;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 15px;
  color: var(--muted);
}
.lg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lg i {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  display: inline-block;
}
.lg .lg-cam {
  background: #fff;
  border: 2px solid #16a34a;
}
.zoom {
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.diagram-wrap {
  overflow: auto;
  max-height: 78vh;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
}
.diagram-wrap svg {
  display: block;
}
.clickable {
  cursor: pointer;
}
.dev.clickable:hover rect:first-of-type {
  filter: brightness(1.12);
}
.cam.clickable:hover > rect:first-of-type {
  fill: #f0fdf4;
}
.empty p {
  max-width: 720px;
}
.form-title {
  font-size: 20px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.cam-head {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.search {
  position: relative;
  margin-bottom: 10px;
}
.search-list {
  position: absolute;
  z-index: 5;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  max-height: 340px;
  overflow: auto;
}
.search-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.search-item:hover {
  background: var(--accent-soft);
}
.cams-table .port {
  width: 90px;
  padding: 6px 10px;
}
.warn-list {
  margin: 0;
  padding: 10px 14px 10px 30px;
  background: var(--warn-soft);
  border: 1px solid var(--warn-line);
  border-radius: 10px;
  color: var(--warn-ink);
}
.actions .spacer {
  flex: 1;
}
.kind {
  color: #fff;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 14px;
  white-space: nowrap;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 12px;
  background: var(--panel-2);
  font-size: 15px;
}
.chip.ghost {
  border-style: dashed;
  background: transparent;
  opacity: 0.65;
}
.chip .badge {
  margin-left: 4px;
}
.infer-head {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 16px;
  flex-wrap: wrap;
}
.infer-head h2 {
  margin: 0 0 4px;
}
.infer-head p {
  max-width: 860px;
  margin: 0;
}
.job-list {
  list-style: none;
  padding: 0;
  margin: 6px 0 0;
  display: grid;
  gap: 6px;
}
.super {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px;
  display: grid;
  gap: 10px;
  background: var(--panel);
}
.super-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.super-head .badge {
  margin-left: 6px;
}
.grp {
  border-left: 4px solid var(--accent-soft-line);
  padding: 6px 0 6px 12px;
  display: grid;
  gap: 8px;
}
.grp.loose {
  border-left-color: var(--line);
}
.done {
  opacity: 0.6;
}
.grp-meta,
.grp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.input-sm {
  padding: 6px 10px;
  width: auto;
  max-width: 260px;
}
</style>

<style>
/* Chop etishda faqat sxema (menyu, tugmalar, formalar yashiriladi). */
@media print {
  .topbar,
  .tabs,
  .no-print {
    display: none !important;
  }
  .diagram-wrap {
    max-height: none !important;
    overflow: visible !important;
    border: 0 !important;
  }
  .diagram-wrap svg {
    max-width: 100%;
    height: auto;
  }
}
</style>
