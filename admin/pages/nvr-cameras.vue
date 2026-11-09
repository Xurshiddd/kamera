<script setup lang="ts">
definePageMeta({ permission: "nvr.manage" });

// NVR'dagi kameralarni shu yerdan nomlash va sozlash: kodek (H.264/H.265),
// o'lcham, sifat, kadr tezligi, Smart kodek. O'zgarish NVR orqali kameraga
// yoziladi; kodek/Smart o'zgarsa kamera ~1 daqiqa qayta ishga tushadi.
interface Stream {
  codec: string;
  width: number;
  height: number;
  rc: string;
  bitrate: number;
  quality: number | null;
  fps: number;
  smart: boolean | null;
}
interface Row {
  channel: number;
  name: string;
  ip: string;
  online: boolean | null;
  stream: Stream | null;
  camera_id: number | null;
  camera_name: string | null;
}
interface Caps {
  codecs: string[];
  resolutions: { width: number; height: number }[];
  rc: string[];
  fps: number[];
  bitrate: { min: number; max: number } | null;
}
interface Nvr { id: number; name: string }

const { call, base } = useNvrApi();
const nvrs = ref<Nvr[]>([]);
const nvrId = ref<number | null>(null);
const rows = ref<Row[]>([]);
const loading = ref(false);
const error = ref("");
const q = ref("");
const show = ref<"all" | "online" | "offline" | "h265">("all");
const page = ref(1);
const PER = 15;

function useNvrApi() {
  const { call } = useApi();
  return { call, base: useRuntimeConfig().public.serviceBase as string };
}

async function loadRows() {
  if (!nvrId.value) return;
  loading.value = true;
  error.value = "";
  try {
    rows.value = await call<Row[]>(`/api/nvrs/${nvrId.value}/streams`);
  } catch (e: any) {
    error.value = e?.data?.error || "NVR’dan maʼlumot olib boʻlmadi.";
  } finally {
    loading.value = false;
  }
}

const label = (r: Row) => r.camera_name || r.name || `Kanal ${r.channel}`;
const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (show.value === "online" && !r.online) return false;
    if (show.value === "offline" && r.online) return false;
    if (show.value === "h265" && r.stream?.codec !== "H.265") return false;
    if (!s) return true;
    return [label(r), r.name, r.ip, `d${r.channel}`, String(r.channel)].some((v) => v?.toLowerCase().includes(s));
  });
});
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PER)));
const visible = computed(() => filtered.value.slice((page.value - 1) * PER, page.value * PER));
watch([q, show], () => (page.value = 1));
const h265 = computed(() => rows.value.filter((r) => r.online && r.stream?.codec === "H.265"));

// --- Tanlangan kamera ---
const sel = ref<Row | null>(null);
const caps = ref<Caps | null>(null);
const form = reactive({ name: "", codec: "", res: "", bitrate: 0, fps: 0, smart: null as boolean | null });
const detailError = ref("");
const detailLoading = ref(false);
const saving = ref(false);
const savingName = ref(false);
const saveMsg = ref("");
const saveErr = ref("");
const restarting = ref(false);
const snap = ref("");
let restartTimer: ReturnType<typeof setTimeout> | null = null;

async function loadSnapshot(r: Row) {
  if (snap.value) URL.revokeObjectURL(snap.value);
  snap.value = "";
  if (!r.online) return;
  try {
    const { token } = useAuth();
    const blob = await $fetch<Blob>(`${base}/api/nvrs/${nvrId.value}/channels/${r.channel}/snapshot`, {
      headers: token.value ? { Authorization: `Bearer ${token.value}` } : {},
      responseType: "blob",
    });
    if (sel.value?.channel === r.channel) snap.value = URL.createObjectURL(blob);
  } catch {
    /* rasm bo'lmasa — joy egallovchi ko'rinadi */
  }
}

async function pick(r: Row) {
  sel.value = r;
  caps.value = null;
  saveMsg.value = "";
  saveErr.value = "";
  detailError.value = "";
  form.name = label(r);
  loadSnapshot(r);
  if (!r.online) return;
  detailLoading.value = true;
  try {
    const d = await call<{ current: Stream; caps: Caps }>(`/api/nvrs/${nvrId.value}/channels/${r.channel}/stream`);
    if (sel.value?.channel !== r.channel) return;
    caps.value = d.caps;
    fillForm(d.current);
    r.stream = d.current;
  } catch (e: any) {
    detailError.value = e?.data?.error || "Kamera sozlamasini oʻqib boʻlmadi.";
  } finally {
    detailLoading.value = false;
  }
}
function fillForm(s: Stream) {
  form.codec = s.codec;
  form.res = `${s.width}x${s.height}`;
  form.bitrate = s.bitrate;
  form.fps = s.fps;
  form.smart = s.smart;
}

const RES_NAMES: Record<string, string> = {
  "1280x720": "HD",
  "1920x1080": "Full HD",
  "2560x1440": "2K",
  "2688x1520": "4 MP",
  "3840x2160": "4K",
};
const resOptions = computed(() =>
  (caps.value?.resolutions || []).map((r) => {
    const k = `${r.width}x${r.height}`;
    return { value: k, text: `${r.width}×${r.height}${RES_NAMES[k] ? ` (${RES_NAMES[k]})` : ""}` };
  })
);
const fpsText = (v: number) => (v === 0 ? "Toʻliq (kamera imkoni boricha)" : `${v / 100} kadr/soniya`);
const fpsOptions = computed(() => (caps.value?.fps || []).filter((v) => v === 0 || v >= 600));
const bitrateText = (v: number) => {
  const name = v <= 512 ? "Past" : v <= 1024 ? "Oʻrtacha" : v <= 2048 ? "Yaxshi" : v <= 4096 ? "Yuqori" : "Juda yuqori";
  return `${name} — ${v >= 1024 ? `${+(v / 1024).toFixed(1)} Mbit/s` : `${v} kbit/s`}`;
};
const bitrateOptions = computed(() => {
  const r = caps.value?.bitrate || { min: 32, max: 16384 };
  const list = [512, 1024, 2048, 3072, 4096, 6144, 8192].filter((v) => v >= r.min && v <= r.max);
  if (form.bitrate && !list.includes(form.bitrate)) list.push(form.bitrate);
  return list.sort((a, b) => a - b);
});

const changes = computed(() => {
  const s = sel.value?.stream;
  if (!s) return {};
  const c: Record<string, any> = {};
  if (form.codec && form.codec !== s.codec) c.codec = form.codec;
  if (form.res && form.res !== `${s.width}x${s.height}`) {
    const [w, h] = form.res.split("x").map(Number);
    c.width = w;
    c.height = h;
  }
  if (form.bitrate && form.bitrate !== s.bitrate) c.bitrate = form.bitrate;
  if (form.fps !== s.fps) c.fps = form.fps;
  if (form.smart !== null && form.smart !== s.smart) c.smart = form.smart;
  return c;
});
const hasChanges = computed(() => Object.keys(changes.value).length > 0);

async function saveName() {
  if (!sel.value) return;
  const r = sel.value;
  const name = form.name.trim();
  saveErr.value = "";
  saveMsg.value = "";
  savingName.value = true;
  try {
    await call(`/api/nvrs/${nvrId.value}/channels/${r.channel}/name`, { method: "PUT", body: { name } });
    r.name = name;
    if (r.camera_id) r.camera_name = name;
    saveMsg.value = r.camera_id ? "Nom NVR’da va saytda saqlandi." : "Nom NVR’da saqlandi.";
  } catch (e: any) {
    saveErr.value = e?.data?.error || "Nomni saqlab boʻlmadi.";
  } finally {
    savingName.value = false;
  }
}

async function save() {
  if (!sel.value || !hasChanges.value) return;
  saving.value = true;
  saveErr.value = "";
  saveMsg.value = "";
  const r = sel.value;
  try {
    const res = await call<{ stream: Stream }>(`/api/nvrs/${nvrId.value}/channels/${r.channel}/stream`, {
      method: "PUT",
      body: changes.value,
    });
    r.stream = { ...r.stream!, ...res.stream };
    fillForm(r.stream);
    // Har qanday oqim o'zgarishidan keyin kamera qayta ulanadi — javob berguncha kutamiz.
    waitRestart(r);
  } catch (e: any) {
    saveErr.value = e?.data?.error || "Saqlab boʻlmadi.";
  } finally {
    saving.value = false;
  }
}

// Saqlangandan keyin kamera qayta ulanguncha (NVR javob berguncha) kutamiz.
function waitRestart(r: Row, tries = 0) {
  restarting.value = true;
  saveMsg.value = "Saqlandi. Kamera qayta ulanmoqda — tasvir 1–2 daqiqa boʻlmasligi mumkin…";
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    try {
      const d = await call<{ current: Stream }>(`/api/nvrs/${nvrId.value}/channels/${r.channel}/stream`);
      r.stream = d.current;
      r.online = true;
      if (sel.value?.channel === r.channel) {
        fillForm(d.current);
        loadSnapshot(r);
      }
      restarting.value = false;
      saveMsg.value = "Saqlandi. Kamera ishlayapti.";
    } catch {
      if (tries < 18) waitRestart(r, tries + 1);
      else {
        restarting.value = false;
        saveMsg.value = "";
        saveErr.value = "Kamera 3 daqiqadan beri javob bermayapti. NVR’da holatini tekshiring.";
      }
    }
  }, 10000);
}

// --- Hammasini H.264 ga o'tkazish ---
const bulkAsk = ref(false);
const bulk = reactive({ running: false, done: 0, total: 0, failed: [] as string[] });
async function runBulk() {
  bulkAsk.value = false;
  const list = [...h265.value];
  Object.assign(bulk, { running: true, done: 0, total: list.length, failed: [] });
  for (const r of list) {
    try {
      const res = await call<{ stream: Stream }>(`/api/nvrs/${nvrId.value}/channels/${r.channel}/stream`, {
        method: "PUT",
        body: { codec: "H.264" },
      });
      r.stream = { ...r.stream!, ...res.stream };
    } catch (e: any) {
      bulk.failed.push(`${label(r)}: ${e?.data?.error || "xato"}`);
    }
    bulk.done++;
  }
  bulk.running = false;
}

watch(nvrId, () => {
  sel.value = null;
  loadRows();
});
onMounted(async () => {
  try {
    nvrs.value = await call<Nvr[]>("/api/nvrs");
    nvrId.value = nvrs.value[0]?.id ?? null;
    if (!nvrId.value) error.value = "Hali NVR qoʻshilmagan. Avval «NVR qurilmalar» boʻlimida NVR qoʻshing.";
  } catch {
    error.value = "NVR roʻyxatini olib boʻlmadi.";
  }
});
onBeforeUnmount(() => {
  if (restartTimer) clearTimeout(restartTimer);
  if (snap.value) URL.revokeObjectURL(snap.value);
});
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h1>Kameralar (NVR)</h1>
        <p class="sub">NVR’dagi kameralarni shu yerdan nomlang va sozlang — oʻzgarish toʻgʻridan-toʻgʻri kameraga yoziladi.</p>
      </div>
      <div class="head-tools">
        <select v-if="nvrs.length > 1" v-model.number="nvrId" class="input" aria-label="NVR">
          <option v-for="n in nvrs" :key="n.id" :value="n.id">{{ n.name }}</option>
        </select>
        <button class="btn btn-soft" :disabled="loading || bulk.running" @click="loadRows">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-4" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.9 4" /><path d="M20 20v-4h-4" /></svg>
          {{ loading ? "Yangilanmoqda…" : "NVR’dan yangilash" }}
        </button>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <!-- H.265 ogohlantirishi -->
    <div v-if="h265.length && !bulk.running && !bulk.total" class="banner">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4" /><path d="M12 17.5h.01" /></svg>
      <p>
        <strong>{{ h265.length }} ta kamera H.265 da ishlayapti.</strong>
        Brauzerda tez ochilishi va server kam yuklanishi uchun H.264 tavsiya etiladi.
      </p>
      <button class="btn warn-btn" @click="bulkAsk = true">Hammasini H.264 ga oʻtkazish</button>
    </div>
    <div v-if="bulkAsk" class="confirm panel" role="alertdialog" aria-labelledby="bulk-t">
      <h2 id="bulk-t">{{ h265.length }} ta kamerani H.264 ga oʻtkazasizmi?</h2>
      <ul>
        <li>Har bir kamera qayta ishga tushadi: <strong>1–2 daqiqa tasvir va yozuv boʻlmaydi.</strong></li>
        <li>Ish vaqtidan tashqarida (kechqurun yoki dam olish kuni) qilish tavsiya etiladi.</li>
        <li>H.264 diskda biroz koʻproq joy oladi — yozuvlar saqlanish muddati qisqarishi mumkin.</li>
      </ul>
      <div class="actions">
        <button class="btn" @click="bulkAsk = false">Bekor qilish</button>
        <button class="btn btn-primary" @click="runBulk">Ha, oʻtkazish</button>
      </div>
    </div>
    <div v-if="bulk.total" class="panel">
      <strong class="bulk-title">
        {{ bulk.running ? "H.264 ga oʻtkazilmoqda…" : "Tayyor" }} — {{ bulk.done }} / {{ bulk.total }}
      </strong>
      <div class="prog" role="progressbar" :aria-valuenow="bulk.done" aria-valuemin="0" :aria-valuemax="bulk.total">
        <div class="prog-bar" :style="{ width: `${(bulk.done / bulk.total) * 100}%` }" />
      </div>
      <p v-if="!bulk.running" class="ok-text">
        Kameralar 1–2 daqiqada qayta ulanadi. Keyin «NVR’dan yangilash» tugmasini bosing.
      </p>
      <div v-if="bulk.failed.length" class="err">
        Oʻtkazilmadi ({{ bulk.failed.length }}):
        <ul><li v-for="f in bulk.failed" :key="f">{{ f }}</li></ul>
      </div>
    </div>

    <div class="layout">
      <!-- Ro'yxat -->
      <section class="list panel" aria-label="Kameralar roʻyxati">
        <div class="list-tools">
          <div class="grow">
            <label class="label" for="kq">Qidirish</label>
            <input id="kq" v-model="q" type="search" class="input" placeholder="nomi, kanal yoki IP" />
          </div>
          <div>
            <label class="label" for="kf">Koʻrsatish</label>
            <select id="kf" v-model="show" class="input">
              <option value="all">Hammasi ({{ rows.length }})</option>
              <option value="online">Faqat ishlayotganlar</option>
              <option value="offline">Faqat aloqasizlar</option>
              <option value="h265">Faqat H.265</option>
            </select>
          </div>
        </div>
        <p v-if="loading && !rows.length" class="muted">NVR’dan olinmoqda…</p>
        <div v-else class="table-wrap flat">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Kanal</th>
                <th scope="col">Nomi</th>
                <th scope="col">Kodek</th>
                <th scope="col">Holat</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in visible"
                :key="r.channel"
                class="row"
                :class="{ on: sel?.channel === r.channel }"
                tabindex="0"
                @click="pick(r)"
                @keydown.enter="pick(r)"
              >
                <td class="ch">D{{ r.channel }}</td>
                <td>
                  <div class="nm">{{ label(r) }}</div>
                  <div class="ip">{{ r.ip }}</div>
                </td>
                <td>
                  <span v-if="r.stream?.codec === 'H.264'" class="badge badge-ok">H.264</span>
                  <span v-else-if="r.stream?.codec === 'H.265'" class="badge badge-warn">H.265</span>
                  <span v-else class="muted">—</span>
                </td>
                <td>
                  <span v-if="r.online" class="st ok"><span class="d" />Ishlayapti</span>
                  <span v-else class="st off"><span class="d" />Aloqa yoʻq</span>
                </td>
              </tr>
              <tr v-if="!visible.length && !loading">
                <td colspan="4" class="muted">Hech narsa topilmadi.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Pager
          v-if="filtered.length"
          v-model="page"
          :pages="pages"
          :info="`${(page - 1) * PER + 1}–${Math.min(page * PER, filtered.length)} / jami ${filtered.length}`"
        />
      </section>

      <!-- Sozlash paneli -->
      <section v-if="sel" class="edit panel" aria-labelledby="ed-t">
        <div>
          <span class="muted">D{{ sel.channel }} kanal · {{ sel.ip }}</span>
          <h2 id="ed-t">{{ label(sel) }}</h2>
        </div>
        <div class="snap">
          <img v-if="snap" :src="snap" :alt="`${label(sel)} — kameradan rasm`" />
          <span v-else>{{ sel.online ? "Rasm olinmoqda…" : "Kamera bilan aloqa yoʻq" }}</span>
        </div>

        <div>
          <label class="label" for="nm">Nomi (NVR va saytda)</label>
          <div class="name-row">
            <input id="nm" v-model="form.name" class="input" maxlength="32" />
            <button
              class="btn btn-soft"
              :disabled="savingName || !form.name.trim() || (form.name.trim() === sel.name && (!sel.camera_id || form.name.trim() === sel.camera_name))"
              @click="saveName"
            >
              {{ savingName ? "Saqlanmoqda…" : "Nomni saqlash" }}
            </button>
          </div>
          <p v-if="!sel.camera_id" class="hint">Nom NVR’da oʻzgaradi. Bu kanal hali saytga qoʻshilmagan — «NVR qurilmalar» boʻlimidan import qilish mumkin.</p>
          <p v-else class="hint">Masalan: 2.208-xona, 1-bino koridor. Kamera login/paroli oʻzgarmaydi.</p>
        </div>

        <p v-if="detailLoading" class="muted">Sozlamalar oʻqilmoqda…</p>
        <p v-if="detailError" class="err">{{ detailError }}</p>
        <p v-if="!sel.online" class="muted">Kamera bilan aloqa yoʻq — sozlamalarni oʻzgartirib boʻlmaydi.</p>

        <template v-if="caps && sel.stream">
          <fieldset class="codec">
            <legend class="label">Video kodek</legend>
            <div class="seg">
              <button
                v-for="c in caps.codecs"
                :key="c"
                type="button"
                class="seg-btn"
                :class="{ on: form.codec === c }"
                :aria-pressed="form.codec === c"
                @click="form.codec = c"
              >
                <span class="seg-main">{{ c }}</span>
                <span class="seg-sub">{{ c === "H.264" ? "tavsiya etiladi" : "kam joy oladi" }}</span>
              </button>
            </div>
            <p v-if="form.codec === 'H.265'" class="warn-note">
              H.265 da jonli tasvir serverda qayta kodlanadi — ochilishi sekinroq va server koʻproq yuklanadi.
            </p>
          </fieldset>

          <div class="grid2">
            <div>
              <label class="label" for="res">Oʻlcham</label>
              <select id="res" v-model="form.res" class="input">
                <option v-for="o in resOptions" :key="o.value" :value="o.value">{{ o.text }}</option>
              </select>
            </div>
            <div>
              <label class="label" for="fps">Kadr tezligi</label>
              <select id="fps" v-model.number="form.fps" class="input">
                <option v-for="v in fpsOptions" :key="v" :value="v">{{ fpsText(v) }}</option>
              </select>
            </div>
            <div class="span2">
              <label class="label" for="br">Sifat (bitreyt)</label>
              <select id="br" v-model.number="form.bitrate" class="input">
                <option v-for="v in bitrateOptions" :key="v" :value="v">{{ bitrateText(v) }}</option>
              </select>
              <p v-if="sel.stream.bitrate < 512" class="hint">
                Hozirgi qiymat juda past ({{ sel.stream.bitrate }} kbit/s) — tasvir xira boʻlishi mumkin.
              </p>
            </div>
          </div>

          <fieldset v-if="form.smart !== null" class="codec">
            <legend class="label">Smart kodek (H.264+ / H.265+)</legend>
            <div class="seg">
              <button type="button" class="seg-btn" :class="{ on: form.smart === false }" :aria-pressed="form.smart === false" @click="form.smart = false">
                <span class="seg-main">Oʻchiq</span>
                <span class="seg-sub">aniq qirqish</span>
              </button>
              <button type="button" class="seg-btn" :class="{ on: form.smart === true }" :aria-pressed="form.smart === true" @click="form.smart = true">
                <span class="seg-main">Yoqilgan</span>
                <span class="seg-sub">kam joy oladi</span>
              </button>
            </div>
            <p class="hint">
              Smart yoqilganda kalit kadrlar siyrak (≈12 soniyada bir) — yozuvni aniq soniyadan ochish qiyinlashadi.
            </p>
          </fieldset>

          <div class="note">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5h.01" /></svg>
            <span>Saqlanganda kamera qayta ulanadi — tasvir va yozuv 1–2 daqiqa toʻxtaydi.</span>
          </div>

          <p v-if="saveMsg" class="ok-text" role="status">{{ saveMsg }}</p>
          <p v-if="saveErr" class="err" role="alert">{{ saveErr }}</p>

          <div class="actions">
            <button class="btn" :disabled="!hasChanges || saving" @click="fillForm(sel.stream!)">Bekor qilish</button>
            <button class="btn btn-primary" :disabled="!hasChanges || saving || restarting" @click="save">
              {{ saving ? "Saqlanmoqda…" : "NVR’ga saqlash" }}
            </button>
          </div>
        </template>
      </section>
      <section v-else class="edit panel empty">
        <p>Sozlash uchun chapdagi roʻyxatdan kamerani tanlang.</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.head-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.head-tools .input {
  width: auto;
}
.banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
  padding: 18px 20px;
  margin-bottom: 22px;
  background: var(--warn-soft);
  border: 2px solid var(--warn-line);
  border-radius: 12px;
  color: var(--warn-ink);
}
.banner p {
  flex: 1 1 400px;
  margin: 0;
  font-size: 19px;
}
.warn-btn {
  background: #92400e;
  border-color: #92400e;
  color: #ffffff;
  font-weight: 700;
}
.warn-btn:hover {
  background: #78350f;
}
.confirm {
  border: 2px solid var(--warn-line);
}
.confirm ul {
  margin: 0;
  padding-left: 22px;
  display: grid;
  gap: 6px;
}
.bulk-title {
  font-size: 20px;
}
.layout {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  align-items: flex-start;
}
.list {
  flex: 999 1 600px;
  min-width: 0;
}
.list-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
}
.grow {
  flex: 1 1 220px;
}
.flat {
  border-radius: 10px;
}
.row {
  cursor: pointer;
}
.row:hover td {
  background: #f9fafb;
}
.row.on td {
  background: var(--accent-soft);
}
.row.on td:first-child {
  box-shadow: inset 4px 0 0 var(--accent);
}
.ch {
  font-weight: 700;
  color: #374151;
  font-variant-numeric: tabular-nums;
}
.nm {
  font-weight: 700;
}
.ip {
  font-size: 15px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.st {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  white-space: nowrap;
}
.st.ok {
  color: var(--ok-ink);
}
.st.off {
  color: var(--danger-ink);
}
.d {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.st.ok .d {
  background: var(--ok);
}
.st.off .d {
  border: 3px solid var(--danger);
}
.edit {
  flex: 1 1 420px;
  max-width: 520px;
  border: 2px solid var(--accent);
  align-content: start;
}
.edit.empty {
  border: 2px dashed var(--line);
  color: var(--muted);
  font-size: 19px;
}
.snap {
  aspect-ratio: 16 / 9;
  background: #1f2937;
  border-radius: 10px;
  display: grid;
  place-items: center;
  overflow: hidden;
  color: #f9fafb;
}
.snap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.name-row {
  display: flex;
  gap: 10px;
}
.name-row .input {
  flex: 1;
  min-width: 0;
}
.codec {
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  gap: 10px;
}
.codec legend {
  margin-bottom: 10px;
}
.seg {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.seg-btn {
  min-height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font: inherit;
  color: #1f2937;
  background: var(--panel);
  border: 3px solid var(--line);
  border-radius: 12px;
  cursor: pointer;
}
.seg-btn.on {
  color: #ffffff;
  background: var(--accent);
  border-color: var(--accent);
}
.seg-main {
  font-size: 21px;
  font-weight: 700;
}
.seg-sub {
  font-size: 15px;
}
.warn-note {
  margin: 0;
  padding: 12px 14px;
  font-size: 17px;
  color: var(--warn-ink);
  background: var(--warn-soft);
  border: 2px solid var(--warn-line);
  border-radius: 10px;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
.span2 {
  grid-column: 1 / -1;
}
.note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: #f9fafb;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  font-size: 17px;
  color: #374151;
}
.note svg {
  flex: none;
  margin-top: 2px;
}
.prog {
  position: relative;
  height: 24px;
  background: #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}
.prog-bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent);
  transition: width 0.4s;
}
</style>
