<script setup lang="ts">
definePageMeta({ permission: "netconfig.manage" });

// Kameralarning IP manzilini (boshqa podsetga) va/yoki parolini ommaviy
// o'zgartirish. Bo'lim alohida parol bilan ochiladi; ochish tokeni faqat
// xotirada (sahifadan chiqilsa yoki muddat tugasa — qayta qulflanadi).
interface NvrRef { nvr_id: number; nvr_name: string; channel: number; name: string; online: boolean | null; camera_id: number | null }
interface Device {
  ip: string;
  name: string | null;
  nvr: NvrRef[];
  direct: { id: number; name: string } | null;
  discovered: { id: number } | null;
  online: boolean | null;
  saved_creds: boolean;
}
interface Item {
  ip: string;
  newIp: string | null;
  name: string | null;
  nvr: string[];
  state: "queued" | "running" | "ok" | "warn" | "error" | "skipped";
  step: string | null;
  msg: string | null;
  model?: string;
  current?: { ip: string; mask: string; gateway: string; dhcp: boolean };
}
interface Job {
  id: string;
  mode: "check" | "apply";
  running: boolean;
  cancelled: boolean;
  started_at: string;
  finished_at: string | null;
  by: string;
  items: Item[];
  summary: { total: number; ok: number; warn: number; error: number; queued: number; running: number };
}

const { call } = useApi();

// ---------------------------------------------------------------- Qulf
const status = ref<{ configured: boolean; canSetup: boolean; ttl: number } | null>(null);
const unlockToken = ref<string | null>(null);
const expiresAt = ref(0);
const now = ref(Date.now());
const lockPw = ref("");
const lockErr = ref("");
const unlocking = ref(false);
const setup = reactive({ account: "", pw: "", pw2: "", err: "", busy: false });
let clock: ReturnType<typeof setInterval> | null = null;

const left = computed(() => Math.max(0, Math.round((expiresAt.value - now.value) / 1000)));
const leftText = computed(() => `${Math.floor(left.value / 60)}:${String(left.value % 60).padStart(2, "0")}`);

function lock() {
  unlockToken.value = null;
  expiresAt.value = 0;
  stopPoll();
}

async function nc<T = any>(path: string, opts: any = {}): Promise<T> {
  try {
    return await call<T>(`/api/netconfig${path}`, {
      ...opts,
      headers: { ...(opts.headers || {}), "X-Netconfig-Token": unlockToken.value || "" },
    });
  } catch (e: any) {
    if (e?.response?.status === 423) lock();
    throw e;
  }
}

async function loadStatus() {
  try {
    status.value = await call("/api/netconfig/status");
  } catch (e: any) {
    lockErr.value = e?.data?.error || "Holatni olib boʻlmadi.";
  }
}

async function unlock() {
  lockErr.value = "";
  unlocking.value = true;
  try {
    const r = await call<{ token: string; expiresIn: number }>("/api/netconfig/unlock", { method: "POST", body: { password: lockPw.value } });
    unlockToken.value = r.token;
    expiresAt.value = Date.now() + r.expiresIn * 1000;
    lockPw.value = "";
    await Promise.all([loadDevices(), loadJob()]);
  } catch (e: any) {
    lockErr.value = e?.data?.error || "Ochib boʻlmadi.";
  } finally {
    unlocking.value = false;
  }
}

async function doSetup() {
  setup.err = "";
  if (setup.pw.length < 10) return (setup.err = "Boʻlim paroli kamida 10 belgi boʻlsin.");
  if (setup.pw !== setup.pw2) return (setup.err = "Parollar bir xil emas.");
  setup.busy = true;
  try {
    await call("/api/netconfig/setup", { method: "POST", body: { accountPassword: setup.account, password: setup.pw } });
    Object.assign(setup, { account: "", pw: "", pw2: "" });
    await loadStatus();
  } catch (e: any) {
    setup.err = e?.data?.error || "Oʻrnatib boʻlmadi.";
  } finally {
    setup.busy = false;
  }
}

// Bo'lim parolini almashtirish (superadmin)
const pwc = reactive({ open: false, current: "", next: "", next2: "", err: "", ok: "" });
async function changeSectionPw() {
  pwc.err = pwc.ok = "";
  if (pwc.next.length < 10) return (pwc.err = "Yangi parol kamida 10 belgi boʻlsin.");
  if (pwc.next !== pwc.next2) return (pwc.err = "Parollar bir xil emas.");
  try {
    await nc("/password", { method: "POST", body: { current: pwc.current, next: pwc.next } });
    Object.assign(pwc, { current: "", next: "", next2: "", open: false });
    lock();
    lockErr.value = "Boʻlim paroli almashtirildi — yangi parol bilan oching.";
  } catch (e: any) {
    pwc.err = e?.data?.error || "Almashtirib boʻlmadi.";
  }
}

onMounted(() => {
  loadStatus();
  clock = setInterval(() => {
    now.value = Date.now();
    if (unlockToken.value && left.value <= 0) {
      lock();
      lockErr.value = "Vaqt tugadi — boʻlim qulflandi.";
    }
  }, 1000);
});
onBeforeUnmount(() => {
  if (clock) clearInterval(clock);
  lock();
});

// ---------------------------------------------------------------- Ro'yxat
const devices = ref<Device[]>([]);
const warnings = ref<string[]>([]);
const loading = ref(false);
const listErr = ref("");

async function loadDevices() {
  loading.value = true;
  listErr.value = "";
  try {
    const r = await nc<{ devices: Device[]; warnings: string[] }>("/devices");
    devices.value = r.devices;
    warnings.value = r.warnings;
    const ips = new Set(r.devices.map((d) => d.ip));
    for (const ip of [...selected.value]) if (!ips.has(ip)) selected.value.delete(ip);
  } catch (e: any) {
    listErr.value = e?.data?.error || "Kameralar roʻyxatini olib boʻlmadi.";
  } finally {
    loading.value = false;
  }
}

const subnet = (ip: string) => ip.replace(/\.\d+$/, "");
const building = (d: Device) => (d.name?.match(/^\s*(\d+)\s*\./) || [])[1] || "";
const where = (d: Device) =>
  [...d.nvr.map((n) => `${n.nvr_name} · D${n.channel}`), d.direct ? "toʻgʻridan" : "", d.discovered ? "skaner" : ""].filter(Boolean).join(", ");

const q = ref("");
const fNvr = ref<string>("");
const fNet = ref<string>("");
const fBld = ref<string>("");
const fState = ref<"all" | "online" | "offline">("all");
const nvrOptions = computed(() => {
  const m = new Map<number, string>();
  for (const d of devices.value) for (const n of d.nvr) m.set(n.nvr_id, n.nvr_name);
  return [...m].map(([id, name]) => ({ id, name }));
});
const nets = computed(() => [...new Set(devices.value.map((d) => subnet(d.ip)))]);
const buildings = computed(() =>
  [...new Set(devices.value.map(building).filter(Boolean))].sort((a, b) => Number(a) - Number(b))
);
const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  return devices.value.filter((d) => {
    if (fNvr.value === "none" && d.nvr.length) return false;
    if (fNvr.value && fNvr.value !== "none" && !d.nvr.some((n) => String(n.nvr_id) === fNvr.value)) return false;
    if (fNet.value && subnet(d.ip) !== fNet.value) return false;
    if (fBld.value && building(d) !== fBld.value) return false;
    if (fState.value === "online" && d.online !== true) return false;
    if (fState.value === "offline" && d.online !== false) return false;
    if (!s) return true;
    return [d.ip, d.name, where(d)].some((v) => v?.toLowerCase().includes(s));
  });
});
const PER = 25;
const page = ref(1);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PER)));
const visible = computed(() => filtered.value.slice((page.value - 1) * PER, page.value * PER));
watch([q, fNvr, fNet, fBld, fState], () => (page.value = 1));
watch(pages, (n) => page.value > n && (page.value = n));

// Tanlash (IP bo'yicha)
const selected = ref(new Set<string>());
const toggle = (ip: string) => {
  const s = new Set(selected.value);
  s.has(ip) ? s.delete(ip) : s.add(ip);
  selected.value = s;
};
const allFilteredOn = computed(() => filtered.value.length > 0 && filtered.value.every((d) => selected.value.has(d.ip)));
function selectFiltered(on: boolean) {
  const s = new Set(selected.value);
  for (const d of filtered.value) on ? s.add(d.ip) : s.delete(d.ip);
  selected.value = s;
}
const clearSel = () => (selected.value = new Set());
const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const numIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
const selList = computed(() => devices.value.filter((d) => selected.value.has(d.ip)));

// ---------------------------------------------------------------- Sozlamalar
const creds = reactive({ login: "admin", parol: "" });
const ipOn = ref(true);
const ipMode = ref<"keep" | "seq">("keep");
const net = reactive({ prefix: "192.168.9", start: "192.168.9.10", mask: "255.255.255.0", gateway: "192.168.9.1", dns: "" });
const gwTouched = ref(false);
watch(
  () => [net.prefix, net.start, ipMode.value],
  () => {
    if (gwTouched.value) return;
    const p = ipMode.value === "keep" ? net.prefix : net.start.replace(/\.\d+$/, "");
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p)) net.gateway = `${p}.1`;
  }
);
const pwOn = ref(false);
const pw = reactive({ next: "", next2: "", show: false });
const overrides = reactive<Record<string, string>>({});

const isIp = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);

// Avtomatik yangi IP'lar (tanlanganlar IP tartibida).
const autoIps = computed(() => {
  const out: Record<string, string> = {};
  if (!ipOn.value) return out;
  const list = [...selList.value].sort((a, b) => ipNum(a.ip) - ipNum(b.ip));
  if (ipMode.value === "keep") {
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(net.prefix.trim())) return out;
    for (const d of list) out[d.ip] = `${net.prefix.trim()}.${d.ip.split(".").pop()}`;
  } else {
    if (!isIp(net.start.trim())) return out;
    const busy = new Set([...devices.value.filter((d) => !selected.value.has(d.ip)).map((d) => d.ip), net.gateway]);
    let n = ipNum(net.start.trim());
    for (const d of list) {
      while (busy.has(numIp(n)) || n % 256 === 0 || n % 256 === 255) n++;
      out[d.ip] = numIp(n++);
    }
  }
  return out;
});
const newIpOf = (ip: string) => (ipOn.value ? (overrides[ip]?.trim() || autoIps.value[ip] || "") : "");

// Mijoz tomonidagi tekshiruvlar (asosiysi baribir serverda).
const pwRules = computed(() => {
  const p = pw.next;
  const kinds = [/[0-9]/, /[a-z]/, /[A-Z]/, /[^0-9a-zA-Z]/].filter((r) => r.test(p)).length;
  return [
    { ok: p.length >= 8 && p.length <= 16, text: "8–16 belgi" },
    { ok: kinds >= 2, text: "kamida 2 xil tur (harf, raqam, belgi)" },
    { ok: !!p && p === pw.next2, text: "ikkala maydon bir xil" },
  ];
});
const problems = computed(() => {
  const out: string[] = [];
  if (!selList.value.length) out.push("Kamera tanlanmagan.");
  if (!creds.login || !creds.parol) out.push("Kameralarning joriy login va parolini kiriting.");
  if (ipOn.value) {
    if (!isIp(net.mask)) out.push("Maska notoʻgʻri.");
    if (!isIp(net.gateway)) out.push("Shlyuz notoʻgʻri.");
    const seen = new Map<string, string>();
    const others = new Set(devices.value.map((d) => d.ip));
    for (const d of selList.value) {
      const n = newIpOf(d.ip);
      if (!n) continue;
      if (!isIp(n)) out.push(`${d.ip}: yangi IP notoʻgʻri (${n}).`);
      else if (seen.has(n)) out.push(`${n} ikki kameraga berilgan (${seen.get(n)} va ${d.ip}).`);
      else if (n !== d.ip && others.has(n)) out.push(`${n} — tizimda shu manzilli boshqa kamera bor.`);
      else if (n === net.gateway) out.push(`${n} — shlyuz manzili.`);
      seen.set(n, d.ip);
    }
  }
  if (pwOn.value && pwRules.value.some((r) => !r.ok)) out.push("Yangi parol talablarga javob bermaydi.");
  if (!ipOn.value && !pwOn.value) out.push("IP yoki parol oʻzgarishini yoqing.");
  return [...new Set(out)];
});

// ---------------------------------------------------------------- Ish (job)
const job = ref<Job | null>(null);
const jobErr = ref("");
const starting = ref(false);
const ask = ref(false);
let poll: ReturnType<typeof setTimeout> | null = null;
const stopPoll = () => {
  if (poll) clearTimeout(poll);
  poll = null;
};

async function loadJob() {
  stopPoll();
  if (!unlockToken.value) return;
  try {
    const wasRunning = job.value?.running;
    job.value = await nc<Job | null>("/jobs/current");
    if (job.value?.running) poll = setTimeout(loadJob, 2000);
    else if (wasRunning && job.value?.mode === "apply") await loadDevices();
  } catch { /* qulflangan bo'lishi mumkin */ }
}

function payload(mode: "check" | "apply") {
  return {
    mode,
    login: creds.login,
    parol: creds.parol,
    newParol: mode === "apply" && pwOn.value ? pw.next : "",
    mask: ipOn.value ? net.mask : "",
    gateway: ipOn.value ? net.gateway : "",
    dns: ipOn.value ? net.dns : "",
    items: selList.value.map((d) => ({ ip: d.ip, newIp: mode === "apply" ? newIpOf(d.ip) || null : null })),
  };
}

async function start(mode: "check" | "apply") {
  jobErr.value = "";
  ask.value = false;
  starting.value = true;
  try {
    job.value = await nc<Job>("/jobs", { method: "POST", body: payload(mode) });
    loadJob();
  } catch (e: any) {
    jobErr.value = e?.data?.error || "Boshlab boʻlmadi.";
  } finally {
    starting.value = false;
  }
}
async function cancel() {
  try {
    job.value = await nc<Job>("/jobs/current/cancel", { method: "POST" });
  } catch (e: any) {
    jobErr.value = e?.data?.error || "Toʻxtatib boʻlmadi.";
  }
}
// Xato bo'lganlarni qayta tanlash (qayta urinish uchun).
function selectFailed() {
  if (!job.value) return;
  selected.value = new Set(job.value.items.filter((i) => i.state === "error" || i.state === "warn" || i.state === "skipped").map((i) => i.ip));
  for (const i of job.value.items) if (i.newIp && selected.value.has(i.ip)) overrides[i.ip] = i.newIp;
}

const resultOf = computed(() => new Map((job.value?.items || []).map((i) => [i.ip, i])));
const pct = computed(() => {
  const s = job.value?.summary;
  return s?.total ? Math.round(((s.total - s.queued - s.running) / s.total) * 100) : 0;
});
const STATE: Record<Item["state"], { text: string; cls: string }> = {
  queued: { text: "Navbatda", cls: "badge-muted" },
  running: { text: "Bajarilmoqda", cls: "badge-warn" },
  ok: { text: "Tayyor", cls: "badge-ok" },
  warn: { text: "Diqqat", cls: "badge-warn" },
  error: { text: "Xato", cls: "badge-danger" },
  skipped: { text: "Oʻtkazildi", cls: "badge-muted" },
};
const ipChanges = computed(() => selList.value.filter((d) => newIpOf(d.ip) && newIpOf(d.ip) !== d.ip).length);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Kamera IP va parol</h1>
        <p class="sub">Koʻp kameraning IP manzilini boshqa tarmoqqa oʻtkazish va parolini bir martada almashtirish. NVR ham avtomatik yangilanadi.</p>
      </div>
      <div v-if="unlockToken" class="unlocked">
        <span class="badge badge-ok">Ochiq · {{ leftText }}</span>
        <button v-if="status?.canSetup" class="btn btn-sm" @click="pwc.open = !pwc.open">Boʻlim paroli</button>
        <button class="btn btn-sm btn-danger" @click="lock">Qulflash</button>
      </div>
    </div>

    <!-- ===================== Qulf ===================== -->
    <section v-if="!unlockToken" class="panel lockbox">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      <template v-if="!status"><p class="muted">Yuklanmoqda…</p></template>
      <template v-else-if="status.configured">
        <h2>Boʻlim himoyalangan</h2>
        <p class="muted">Bu boʻlim kameralar tarmogʻini oʻzgartiradi. Davom etish uchun boʻlimning alohida parolini kiriting.</p>
        <form class="lockform" @submit.prevent="unlock">
          <label class="label" for="lpw">Boʻlim paroli</label>
          <input id="lpw" v-model="lockPw" class="input" type="password" autocomplete="off" autofocus />
          <button class="btn btn-primary" :disabled="!lockPw || unlocking">{{ unlocking ? "Tekshirilmoqda…" : "Ochish" }}</button>
        </form>
        <p v-if="lockErr" class="err">{{ lockErr }}</p>
      </template>
      <template v-else-if="status.canSetup">
        <h2>Boʻlim parolini oʻrnating</h2>
        <p class="muted">Birinchi marta: bu boʻlimga kirish uchun alohida parol tanlang (hisob parolingizdan farqli, kamida 10 belgi).</p>
        <form class="lockform" @submit.prevent="doSetup">
          <label class="label" for="sa">Hisob parolingiz (tasdiqlash uchun)</label>
          <input id="sa" v-model="setup.account" class="input" type="password" autocomplete="current-password" />
          <label class="label" for="sp">Yangi boʻlim paroli</label>
          <input id="sp" v-model="setup.pw" class="input" type="password" autocomplete="new-password" />
          <label class="label" for="sp2">Takrorlang</label>
          <input id="sp2" v-model="setup.pw2" class="input" type="password" autocomplete="new-password" />
          <button class="btn btn-primary" :disabled="setup.busy">Oʻrnatish</button>
        </form>
        <p v-if="setup.err" class="err">{{ setup.err }}</p>
      </template>
      <template v-else>
        <h2>Boʻlim paroli oʻrnatilmagan</h2>
        <p class="muted">Superadmin parol oʻrnatishi kerak (yoki serverdagi <code>.env</code> faylida <code>NETCONFIG_PASSWORD</code>).</p>
      </template>
    </section>

    <!-- ===================== Ochiq ===================== -->
    <template v-else>
      <section v-if="pwc.open" class="panel">
        <h2>Boʻlim parolini almashtirish</h2>
        <div class="grid3">
          <div><label class="label" for="pc1">Joriy parol</label><input id="pc1" v-model="pwc.current" class="input" type="password" /></div>
          <div><label class="label" for="pc2">Yangi parol</label><input id="pc2" v-model="pwc.next" class="input" type="password" autocomplete="new-password" /></div>
          <div><label class="label" for="pc3">Takrorlang</label><input id="pc3" v-model="pwc.next2" class="input" type="password" autocomplete="new-password" /></div>
        </div>
        <p v-if="pwc.err" class="err">{{ pwc.err }}</p>
        <div class="actions">
          <button class="btn" @click="pwc.open = false">Bekor</button>
          <button class="btn btn-primary" @click="changeSectionPw">Almashtirish</button>
        </div>
      </section>

      <div class="notice">
        <strong>Oldin tekshiring:</strong> yangi tarmoq (masalan 192.168.9.0/24) routerda sozlangan boʻlishi va server hamda NVR unga yeta olishi kerak — aks holda kameralar NVR’dan uziladi.
        Avval 1–2 kamerada sinab koʻring. IP oʻzgarganda har bir kamera taxminan 1–2 daqiqa yozuvsiz qoladi.
      </div>
      <p v-for="w in warnings" :key="w" class="err">{{ w }}</p>

      <!-- Jarayon -->
      <section v-if="job" class="panel">
        <div class="jobhead">
          <h2>{{ job.mode === "check" ? "Tekshiruv" : "Oʻzgartirish" }} {{ job.running ? "bajarilmoqda" : job.cancelled ? "toʻxtatildi" : "yakunlandi" }}</h2>
          <div class="actions">
            <button v-if="job.running" class="btn btn-danger" @click="cancel">Toʻxtatish</button>
            <button v-if="!job.running && (job.summary.error || job.summary.warn)" class="btn btn-soft" @click="selectFailed">Muammolilarni qayta tanlash</button>
          </div>
        </div>
        <div class="bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: pct + '%' }" /></div>
        <p class="summary">
          Jami {{ job.summary.total }} · <span class="badge badge-ok">Tayyor {{ job.summary.ok }}</span>
          <span class="badge badge-warn">Diqqat {{ job.summary.warn }}</span>
          <span class="badge badge-danger">Xato {{ job.summary.error }}</span>
          <span v-if="job.running" class="badge badge-muted">Qoldi {{ job.summary.queued + job.summary.running }}</span>
          <span class="muted small">· {{ job.by }}</span>
        </p>
        <details :open="job.items.length <= 20">
          <summary>Har bir kamera natijasi</summary>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>IP</th><th>Kamera</th><th>Holat</th><th>Izoh</th></tr></thead>
              <tbody>
                <tr v-for="i in job.items" :key="i.ip">
                  <td class="mono">{{ i.ip }}<template v-if="i.newIp"> → {{ i.newIp }}</template></td>
                  <td>{{ i.name || "—" }}<div v-if="i.model" class="muted small">{{ i.model }}</div></td>
                  <td><span class="badge" :class="STATE[i.state].cls">{{ STATE[i.state].text }}</span></td>
                  <td class="small">{{ i.step || i.msg || "" }}<div v-if="i.current && job.mode === 'check'" class="muted">hozir: {{ i.current.ip }} / {{ i.current.mask }} · shlyuz {{ i.current.gateway || "—" }}</div></td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <div class="layout">
        <!-- Kameralar -->
        <section class="panel">
          <div class="jobhead">
            <h2>Kameralar <span class="muted small">({{ devices.length }})</span></h2>
            <button class="btn btn-sm" :disabled="loading" @click="loadDevices">{{ loading ? "Yuklanmoqda…" : "Yangilash" }}</button>
          </div>
          <div class="filters">
            <input v-model="q" class="input" placeholder="Qidirish: IP, nom, NVR…" aria-label="Qidirish" />
            <select v-model="fNvr" class="input" aria-label="NVR"><option value="">Barcha NVR</option><option v-for="n in nvrOptions" :key="n.id" :value="String(n.id)">{{ n.name }}</option><option value="none">NVR’siz</option></select>
            <select v-model="fNet" class="input" aria-label="Tarmoq"><option value="">Barcha tarmoqlar</option><option v-for="n in nets" :key="n" :value="n">{{ n }}.x</option></select>
            <select v-model="fBld" class="input" aria-label="Bino"><option value="">Barcha binolar</option><option v-for="b in buildings" :key="b" :value="b">{{ b }}-bino</option></select>
            <select v-model="fState" class="input" aria-label="Holat"><option value="all">Hammasi</option><option value="online">Onlayn</option><option value="offline">Oflayn</option></select>
          </div>
          <div class="selbar">
            <button class="btn btn-sm btn-soft" :disabled="!filtered.length" @click="selectFiltered(!allFilteredOn)">
              {{ allFilteredOn ? "Filtrdagilarni olib tashlash" : `Filtrdagi ${filtered.length} tasini belgilash` }}
            </button>
            <button class="btn btn-sm" :disabled="!selected.size" @click="clearSel">Tozalash</button>
            <strong>Tanlangan: {{ selected.size }}</strong>
          </div>
          <p v-if="listErr" class="err">{{ listErr }}</p>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th><input type="checkbox" class="cb" :checked="allFilteredOn" aria-label="Hammasini belgilash" @change="selectFiltered(!allFilteredOn)" /></th>
                  <th>IP</th><th>Nom</th><th>Qayerda</th><th>Holat</th><th v-if="ipOn">Yangi IP</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in visible" :key="d.ip" :class="{ on: selected.has(d.ip) }">
                  <td><input type="checkbox" class="cb" :checked="selected.has(d.ip)" :aria-label="`${d.ip} belgilash`" @change="toggle(d.ip)" /></td>
                  <td class="mono">{{ d.ip }}</td>
                  <td>{{ d.name || "—" }}</td>
                  <td class="small">{{ where(d) }}</td>
                  <td>
                    <span v-if="resultOf.get(d.ip)" class="badge" :class="STATE[resultOf.get(d.ip)!.state].cls">{{ STATE[resultOf.get(d.ip)!.state].text }}</span>
                    <span v-else-if="d.online === true" class="badge badge-ok">Onlayn</span>
                    <span v-else-if="d.online === false" class="badge badge-danger">Oflayn</span>
                    <span v-else class="badge badge-muted">—</span>
                  </td>
                  <td v-if="ipOn">
                    <input v-if="selected.has(d.ip)" v-model="overrides[d.ip]" class="input input-ip mono" :placeholder="autoIps[d.ip] || 'yangi IP'" :aria-label="`${d.ip} yangi IP`" />
                  </td>
                </tr>
                <tr v-if="!visible.length"><td :colspan="ipOn ? 6 : 5" class="muted">{{ loading ? "Yuklanmoqda…" : "Kamera topilmadi" }}</td></tr>
              </tbody>
            </table>
          </div>
          <Pager v-model="page" :pages="pages" :info="`${filtered.length} ta`" />
        </section>

        <!-- Sozlamalar -->
        <section class="panel side">
          <h2>Nima oʻzgarsin</h2>

          <fieldset>
            <legend>Kameralarning hozirgi paroli</legend>
            <div class="row2">
              <div><label class="label" for="cl">Login</label><input id="cl" v-model="creds.login" class="input" autocomplete="off" /></div>
              <div><label class="label" for="cp">Parol</label><input id="cp" v-model="creds.parol" class="input" type="password" autocomplete="off" /></div>
            </div>
            <p class="hint">Hamma tanlanganlar uchun bitta. Saqlangan paroli bor kameralarda u ham sinaladi. Koʻp xato urinishda kamera vaqtincha bloklanadi.</p>
          </fieldset>

          <fieldset>
            <legend><label class="check"><input v-model="ipOn" type="checkbox" /> IP manzilni oʻzgartirish</label></legend>
            <template v-if="ipOn">
              <div class="seg">
                <button type="button" :class="{ on: ipMode === 'keep' }" :aria-pressed="ipMode === 'keep'" @click="ipMode = 'keep'">Oxirgi raqam saqlansin<small>192.168.18.<b>45</b> → 192.168.9.<b>45</b></small></button>
                <button type="button" :class="{ on: ipMode === 'seq' }" :aria-pressed="ipMode === 'seq'" @click="ipMode = 'seq'">Ketma-ket<small>boshlangʻich manzildan</small></button>
              </div>
              <div v-if="ipMode === 'keep'"><label class="label" for="np">Yangi tarmoq (3 ta raqam)</label><input id="np" v-model="net.prefix" class="input mono" placeholder="192.168.9" /></div>
              <div v-else><label class="label" for="ns">Boshlangʻich IP</label><input id="ns" v-model="net.start" class="input mono" placeholder="192.168.9.10" /></div>
              <div class="row2">
                <div><label class="label" for="nm">Maska</label><input id="nm" v-model="net.mask" class="input mono" /></div>
                <div><label class="label" for="ng">Shlyuz (gateway)</label><input id="ng" v-model="net.gateway" class="input mono" @input="gwTouched = true" /></div>
              </div>
              <div><label class="label" for="nd">DNS (ixtiyoriy)</label><input id="nd" v-model="net.dns" class="input mono" placeholder="oʻzgarmaydi" /></div>
              <p class="hint">Jadvalda har bir kamera uchun yangi IP’ni qoʻlda ham yozish mumkin.</p>
            </template>
          </fieldset>

          <fieldset>
            <legend><label class="check"><input v-model="pwOn" type="checkbox" /> Parolni almashtirish</label></legend>
            <template v-if="pwOn">
              <div><label class="label" for="pn">Yangi parol</label><input id="pn" v-model="pw.next" class="input" :type="pw.show ? 'text' : 'password'" autocomplete="new-password" /></div>
              <div><label class="label" for="pn2">Takrorlang</label><input id="pn2" v-model="pw.next2" class="input" :type="pw.show ? 'text' : 'password'" autocomplete="new-password" /></div>
              <label class="check small"><input v-model="pw.show" type="checkbox" /> Parolni koʻrsatish</label>
              <ul class="rules">
                <li v-for="r in pwRules" :key="r.text" :class="{ ok: r.ok }">{{ r.ok ? "✓" : "✗" }} {{ r.text }}</li>
              </ul>
              <p class="hint">NVR’dagi kanal paroli ham yangilanadi. Yangi parolni xavfsiz joyga yozib qoʻying.</p>
            </template>
          </fieldset>

          <ul v-if="problems.length" class="problems">
            <li v-for="p in problems" :key="p">{{ p }}</li>
          </ul>
          <p v-if="jobErr" class="err">{{ jobErr }}</p>
          <div class="actions">
            <button class="btn" :disabled="!selected.size || !creds.parol || starting || job?.running" @click="start('check')">Tekshirish (oʻzgartirmaydi)</button>
            <button class="btn btn-primary" :disabled="problems.length > 0 || starting || job?.running" @click="ask = true">Qoʻllash…</button>
          </div>
        </section>
      </div>

      <!-- Tasdiqlash -->
      <div v-if="ask" class="overlay" role="alertdialog" aria-modal="true" aria-labelledby="ask-t" @click.self="ask = false">
        <div class="panel dialog">
          <h2 id="ask-t">Tasdiqlang</h2>
          <ul>
            <li><strong>{{ selList.length }}</strong> ta kamera</li>
            <li v-if="ipOn && ipChanges">{{ ipChanges }} tasining IP manzili oʻzgaradi (maska {{ net.mask }}, shlyuz {{ net.gateway }})</li>
            <li v-if="pwOn">Login «{{ creds.login }}» paroli almashtiriladi</li>
            <li>NVR kanallari avtomatik yangilanadi</li>
          </ul>
          <p class="hint">Server yangi tarmoqqa yeta olmasa, natija «tasdiqlanmadi» deb chiqadi. Jarayonni istalgan vaqtda toʻxtatish mumkin (boshlanganlari oxirigacha bajariladi).</p>
          <div class="actions">
            <button class="btn" @click="ask = false">Bekor qilish</button>
            <button class="btn btn-primary" @click="start('apply')">Ha, oʻzgartirish</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.unlocked { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.lockbox { max-width: 560px; justify-items: start; }
.lockbox svg { color: var(--accent); }
.lockform { display: grid; gap: 10px; width: 100%; }
.notice {
  background: var(--warn-soft); border: 2px solid var(--warn-line); color: var(--warn-ink);
  border-radius: 10px; padding: 14px 16px; margin-bottom: 22px;
}
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 22px; align-items: start; }
@media (max-width: 1200px) { .layout { grid-template-columns: 1fr; } }
.side { position: sticky; top: 100px; }
@media (max-width: 1200px) { .side { position: static; } }
.filters { display: grid; grid-template-columns: 2fr repeat(4, 1fr); gap: 10px; }
@media (max-width: 900px) { .filters { grid-template-columns: 1fr 1fr; } }
.selbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.cb { width: 22px; height: 22px; accent-color: var(--accent); }
tr.on td { background: var(--accent-soft); }
.input-ip { min-height: 42px; width: 170px; font-size: 16px; padding: 4px 10px; }
fieldset { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px 14px; margin: 0; display: grid; gap: 12px; }
legend { font-weight: 700; padding: 0 6px; }
legend .check { min-height: 0; font-size: 18px; font-weight: 700; }
.seg { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.seg button {
  display: grid; gap: 2px; text-align: left; padding: 10px 12px; border-radius: 10px;
  border: 2px solid var(--line-strong); background: var(--panel); font: inherit; font-weight: 600; cursor: pointer;
}
.seg button small { font-weight: 400; color: var(--muted); font-size: 14px; }
.seg button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-dark); }
.rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 16px; color: var(--danger-ink); }
.rules li.ok { color: var(--ok-ink); }
.problems { margin: 0; padding-left: 20px; color: var(--warn-ink); font-size: 16px; }
.jobhead { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; }
.bar { height: 14px; background: var(--panel-2); border-radius: 8px; overflow: hidden; border: 1px solid var(--line); }
.bar span { display: block; height: 100%; background: var(--accent); transition: width 0.3s; }
.summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; }
details summary { cursor: pointer; font-weight: 600; margin-bottom: 10px; }
.overlay { position: fixed; inset: 0; background: rgba(17, 24, 39, 0.5); display: grid; place-items: center; z-index: 50; padding: 16px; }
.dialog { max-width: 560px; width: 100%; margin: 0; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 800px) { .grid3 { grid-template-columns: 1fr; } }
</style>
