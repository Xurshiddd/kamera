<script setup lang="ts">
definePageMeta({ permission: "discovery.manage" });

// Tarmoq skaneri: lokal tarmoqdagi NVR'ga ulanmagan kameralarni topadi.
// Topilganlar serverda saqlanadi; login/parol bilan ulanib tekshirilgach
// asosiy kameralar ro'yxatiga o'tkaziladi (source = 'scan').
interface Found {
  id: number;
  ip: string;
  ports: number[];
  vendor: string | null;
  model: string | null;
  hint: string | null;
  in_nvr: string | null;
  kind: "camera" | "nvr" | "other" | null;
  kind_manual: boolean;
  server: string | null;
  device_name: string | null;
  serial: string | null;
  mac: string | null;
  firmware: string | null;
  note: string | null;
  nvr_id: number | null;
  nvr_name: string | null;
  login: string | null;
  rtsp_port: number;
  rtsp_path: string | null;
  codec: string | null;
  width: number | null;
  height: number | null;
  connected_at: string | null;
  camera_id: number | null;
  camera_name: string | null;
  first_seen: string;
  last_seen: string;
  status: "new" | "connected" | "added" | "nvr_added";
}
interface Job {
  running: boolean;
  targets: string;
  total: number;
  done: number;
  found: number;
  added: number;
  skippedNvr: number;
  warnings: string[];
  error: string | null;
  finished_at: string | null;
}
interface Group { id: number; name: string }

const { call, base } = useApi();
const { can, token } = useAuth();

const rows = ref<Found[]>([]);
const loading = ref(true);
const error = ref("");

// --- Skan ---
const LS_KEY = "kamera.scanTargets";
const targets = ref("");
const job = ref<Job | null>(null);
const scanErr = ref("");
let poll: ReturnType<typeof setTimeout> | null = null;

async function loadRows() {
  try {
    rows.value = await call<Found[]>("/api/discovery");
    error.value = "";
  } catch (e: any) {
    error.value = e?.data?.error || "Roʻyxatni olib boʻlmadi.";
  } finally {
    loading.value = false;
  }
}

async function startScan() {
  scanErr.value = "";
  try {
    job.value = await call<Job>("/api/discovery/scan", { method: "POST", body: { targets: targets.value } });
    try {
      localStorage.setItem(LS_KEY, targets.value);
    } catch { /* saqlanmasa ham bo'ladi */ }
    watchJob();
  } catch (e: any) {
    scanErr.value = e?.data?.error || "Skanerni boshlab boʻlmadi.";
  }
}

async function watchJob() {
  if (poll) clearTimeout(poll);
  try {
    job.value = await call<Job | null>("/api/discovery/scan");
  } catch { /* keyingi urinish */ }
  if (job.value?.running) poll = setTimeout(watchJob, 1000);
  else if (job.value) await loadRows();
}

const pct = computed(() => (job.value?.total ? Math.round((job.value.done / job.value.total) * 100) : 0));

// --- Ro'yxat filtri ---
const q = ref("");
const show = ref<"todo" | "new" | "connected" | "added" | "nvr" | "all">("todo");
// "Biriktirilgan" = kameralarga yoki NVR'ga qo'shilgan yoki NVR'da bor.
const attached = (r: Found) => r.status === "added" || r.status === "nvr_added" || !!r.in_nvr;
const counts = computed(() => ({
  todo: rows.value.filter((r) => !attached(r)).length,
  new: rows.value.filter((r) => !attached(r) && r.status === "new").length,
  connected: rows.value.filter((r) => !attached(r) && r.status === "connected").length,
  added: rows.value.filter((r) => r.status === "added").length,
  nvrAdded: rows.value.filter((r) => r.status === "nvr_added").length,
  nvr: rows.value.filter((r) => r.in_nvr && r.status === "new").length,
  all: rows.value.length,
}));
const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (show.value === "todo" && attached(r)) return false;
    if (show.value === "new" && (attached(r) || r.status !== "new")) return false;
    if (show.value === "connected" && (attached(r) || r.status !== "connected")) return false;
    if (show.value === "added" && r.status !== "added") return false;
    if (show.value === "nvr" && !(r.status === "nvr_added" || r.in_nvr)) return false;
    if (!s) return true;
    return [r.ip, r.vendor, r.model, r.hint, r.device_name, r.note, r.camera_name, r.nvr_name].some((v) => v?.toLowerCase().includes(s));
  });
});
const PER = 20;
const page = ref(1);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PER)));
const visible = computed(() => filtered.value.slice((page.value - 1) * PER, page.value * PER));
watch([q, show], () => (page.value = 1));
watch(pages, (n) => page.value > n && (page.value = n));

const device = (r: Found) => r.device_name || [r.vendor, r.model].filter(Boolean).join(" ") || "Nomaʼlum qurilma";

// Tur yorlig'i: aniq (ulanganda) yoki taxmin (skan). "?" = noma'lum.
const KINDS: Record<string, string> = { camera: "Kamera", nvr: "NVR / DVR", other: "Boshqa qurilma" };
function kindLabel(r: Found) {
  if (r.kind) return { text: KINDS[r.kind], sure: r.kind_manual || r.status !== "new" };
  return { text: "Turi nomaʼlum", sure: false };
}

// --- Tanlangan qurilma: ulanish va o'tkazish ---
const sel = ref<Found | null>(null);
const conn = reactive({ login: "admin", parol: "", rtspPort: 554, rtspPath: "", advanced: false });
const connecting = ref(false);
const connErr = ref("");
const snap = ref("");
const snapLoading = ref(false);
const promo = reactive({ name: "", isPublic: false, groupId: "" as number | "" });
const promoting = ref(false);
const promoErr = ref("");
const promoMsg = ref("");
const groups = ref<Group[]>([]);

const noteEdit = ref("");
function pick(r: Found) {
  sel.value = r;
  connErr.value = "";
  connMsg.value = "";
  promoErr.value = "";
  promoMsg.value = "";
  noteEdit.value = r.note || "";
  Object.assign(conn, {
    login: r.login || "admin",
    parol: "",
    rtspPort: r.rtsp_port || 554,
    rtspPath: r.rtsp_path || "",
    advanced: false,
  });
  promo.name = "";
  promo.isPublic = false;
  promo.groupId = "";
  loadSnap(r);
}

async function loadSnap(r: Found) {
  if (snap.value) URL.revokeObjectURL(snap.value);
  snap.value = "";
  if (r.status === "new") return;
  snapLoading.value = true;
  try {
    const blob = await $fetch<Blob>(`${base}/api/discovery/${r.id}/snapshot`, {
      headers: token.value ? { Authorization: `Bearer ${token.value}` } : {},
      responseType: "blob",
    });
    if (sel.value?.id === r.id) snap.value = URL.createObjectURL(blob);
  } catch { /* rasm bo'lmasa joy egallovchi */ }
  if (sel.value?.id === r.id) snapLoading.value = false;
}

function replaceRow(n: Found) {
  const i = rows.value.findIndex((x) => x.id === n.id);
  if (i >= 0) rows.value[i] = n;
  sel.value = n;
}

const connMsg = ref("");
async function connect() {
  if (!sel.value) return;
  connErr.value = "";
  connMsg.value = "";
  connecting.value = true;
  try {
    const n = await call<Found>(`/api/discovery/${sel.value.id}/connect`, {
      method: "POST",
      body: {
        login: conn.login,
        parol: conn.parol,
        rtspPort: conn.rtspPort,
        rtspPath: conn.advanced ? conn.rtspPath : "",
      },
    });
    replaceRow(n);
    conn.parol = "";
    if (n.status === "nvr_added") connMsg.value = `NVR aniqlandi va «${n.nvr_name}» nomi bilan NVR qurilmalarga qoʻshildi.`;
    else loadSnap(n);
  } catch (e: any) {
    connErr.value = e?.data?.error || "Ulanib boʻlmadi.";
    if (e?.data?.row) replaceRow(e.data.row); // model/seriya aniqlangan bo'lishi mumkin
    if (e?.data?.reason === "path") conn.advanced = true;
  } finally {
    connecting.value = false;
  }
}

// Qo'lda tur yoki izoh belgilash.
const savingMeta = ref(false);
async function saveMeta(patch: { kind?: string | null; note?: string }) {
  if (!sel.value) return;
  savingMeta.value = true;
  try {
    replaceRow(await call<Found>(`/api/discovery/${sel.value.id}`, { method: "PUT", body: patch }));
  } catch (e: any) {
    alert(e?.data?.error || "Saqlab boʻlmadi");
  } finally {
    savingMeta.value = false;
  }
}

async function promote() {
  if (!sel.value) return;
  promoErr.value = "";
  promoting.value = true;
  try {
    const r = await call<{ row: Found }>(`/api/discovery/${sel.value.id}/promote`, {
      method: "POST",
      body: { name: promo.name, isPublic: promo.isPublic, groupId: promo.groupId || null },
    });
    replaceRow(r.row);
    promoMsg.value = `«${r.row.camera_name}» kameralar roʻyxatiga qoʻshildi.`;
  } catch (e: any) {
    promoErr.value = e?.data?.error || "Qoʻshib boʻlmadi.";
  } finally {
    promoting.value = false;
  }
}

async function removeRow(r: Found) {
  if (!confirm(`${r.ip} roʻyxatdan olib tashlansinmi? Keyingi skanerlashda yana chiqishi mumkin.`)) return;
  try {
    await call(`/api/discovery/${r.id}`, { method: "DELETE" });
    rows.value = rows.value.filter((x) => x.id !== r.id);
    if (sel.value?.id === r.id) sel.value = null;
  } catch (e: any) {
    alert(e?.data?.error || "Xatolik");
  }
}

onMounted(async () => {
  let saved = "";
  try {
    saved = localStorage.getItem(LS_KEY) || "";
  } catch { /* yo'q */ }
  const [sug] = await Promise.all([
    call<{ networks: string[] }>("/api/discovery/suggest").catch(() => ({ networks: [] })),
    loadRows(),
    watchJob(),
  ]);
  targets.value = saved || sug.networks.join(", ") || "192.168.1.0/24";
  if (can("groups.manage") || can("cameras.manage")) {
    groups.value = await call<Group[]>("/api/groups").catch(() => []);
  }
});
onBeforeUnmount(() => {
  if (poll) clearTimeout(poll);
  if (snap.value) URL.revokeObjectURL(snap.value);
});
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h1>Tarmoq skaneri</h1>
        <p class="sub">Lokal tarmoqdagi NVR’ga ulanmagan kameralarni topadi. Topilganlar saqlanib turadi — login/parol bilan ulanib, kameralar roʻyxatiga oʻtkazing.</p>
      </div>
    </div>

    <!-- Skan -->
    <form class="panel scan" @submit.prevent="startScan">
      <label class="label" for="tg">Qaysi tarmoqni skanerlash</label>
      <div class="scan-row">
        <input id="tg" v-model="targets" class="input mono" placeholder="192.168.18.0/24" :disabled="job?.running" />
        <button class="btn btn-primary" type="submit" :disabled="job?.running || !targets.trim()">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          {{ job?.running ? "Skanerlanmoqda…" : "Skanerlash" }}
        </button>
      </div>
      <p class="hint">Bir nechtasini vergul bilan yozish mumkin: 192.168.18.0/24, 192.168.19.10-50. Bir martada 2048 tagacha manzil (/24 ~10 soniya).</p>
      <p v-if="scanErr" class="err">{{ scanErr }}</p>

      <template v-if="job">
        <div v-if="job.running" class="prog" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
          <div class="prog-bar" :style="{ width: `${pct}%` }" />
        </div>
        <p v-if="job.running" class="muted">{{ job.done }} / {{ job.total }} manzil tekshirildi · {{ job.found }} ta qurilma topildi</p>
        <p v-else-if="job.error" class="err">Skaner xatosi: {{ job.error }}</p>
        <p v-else class="ok-text">
          Tayyor ({{ job.targets }}): {{ job.found }} ta qurilma topildi,
          {{ job.skippedNvr }} tasi NVR’da bor, <strong>{{ job.added }} ta yangi</strong> roʻyxatga qoʻshildi.
        </p>
        <p v-for="w in job.warnings" :key="w" class="warn-text">{{ w }}</p>
      </template>
    </form>

    <p v-if="error" class="err">{{ error }}</p>

    <div class="layout">
      <section class="list" aria-label="Topilgan qurilmalar">
        <div class="list-tools">
          <div class="grow">
            <label class="label" for="dq">Qidirish</label>
            <input id="dq" v-model="q" type="search" class="input" placeholder="IP yoki model" />
          </div>
          <div>
            <label class="label" for="ds">Koʻrsatish</label>
            <select id="ds" v-model="show" class="input">
              <option value="todo">Qoʻshilmaganlar ({{ counts.todo }})</option>
              <option value="new">Yangi — ulanilmagan ({{ counts.new }})</option>
              <option value="connected">Ulangan ({{ counts.connected }})</option>
              <option value="added">Kameralarga oʻtkazilgan ({{ counts.added }})</option>
              <option value="nvr">NVR’da ({{ counts.nvrAdded + counts.nvr }})</option>
              <option value="all">Hammasi ({{ counts.all }})</option>
            </select>
          </div>
        </div>

        <p v-if="loading" class="muted">Yuklanmoqda…</p>
        <p v-else-if="!rows.length" class="muted empty-note">Hali hech narsa topilmagan. Yuqorida tarmoqni kiriting va «Skanerlash»ni bosing.</p>
        <div v-else class="table-wrap flat">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">IP manzil</th>
                <th scope="col">Qurilma</th>
                <th scope="col">Turi</th>
                <th scope="col">Holat</th>
                <th scope="col">Oxirgi koʻrilgan</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in visible"
                :key="r.id"
                class="row"
                :class="{ on: sel?.id === r.id }"
                tabindex="0"
                @click="pick(r)"
                @keydown.enter="pick(r)"
              >
                <td class="ipc mono">{{ r.ip }}</td>
                <td>
                  <div class="nm">{{ device(r) }}</div>
                  <div v-if="r.note" class="ip note">✎ {{ r.note }}</div>
                  <div v-else-if="r.model && r.device_name" class="ip">{{ r.model }}</div>
                </td>
                <td>
                  <span class="kind" :class="`k-${r.kind || 'unknown'}`">
                    {{ kindLabel(r).text }}<template v-if="r.kind && !kindLabel(r).sure"> ?</template>
                  </span>
                </td>
                <td>
                  <span v-if="r.status === 'added'" class="badge badge-ok">Kameralarda</span>
                  <span v-else-if="r.status === 'nvr_added'" class="badge badge-ok" :title="r.nvr_name || ''">NVR qoʻshilgan</span>
                  <span v-else-if="r.in_nvr" class="badge badge-muted" :title="r.in_nvr">NVR’da</span>
                  <span v-else-if="r.status === 'connected'" class="badge badge-live">Ulangan</span>
                  <span v-else class="badge badge-warn">Yangi</span>
                </td>
                <td class="small">{{ fmtUtc(r.last_seen, false) }}</td>
              </tr>
              <tr v-if="!visible.length">
                <td colspan="5" class="muted">Bu filtrda hech narsa yoʻq.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Pager
          v-if="filtered.length > PER"
          v-model="page"
          :pages="pages"
          :info="`${(page - 1) * PER + 1}–${Math.min(page * PER, filtered.length)} / jami ${filtered.length}`"
        />
      </section>

      <!-- Tanlangan qurilma -->
      <section v-if="sel" class="edit panel" aria-labelledby="sel-t">
        <div class="sel-head">
          <div>
            <span class="muted">{{ device(sel) }}</span>
            <h2 id="sel-t" class="mono">{{ sel.ip }}</h2>
          </div>
          <a :href="`http://${sel.ip}`" target="_blank" rel="noopener noreferrer" class="btn btn-sm">Veb sahifasi ↗</a>
        </div>
        <p class="small muted">
          Ochiq portlar: {{ sel.ports.join(", ") }} · birinchi topilgan {{ fmtUtc(sel.first_seen, false) }}
          <template v-if="sel.in_nvr"><br />NVR’da: {{ sel.in_nvr }}</template>
        </p>

        <!-- Aniqlangan ma'lumotlar (login/parol bilan ulangandan keyin) -->
        <dl v-if="sel.serial || sel.firmware || sel.mac" class="info">
          <template v-if="sel.model"><dt>Model</dt><dd class="mono">{{ sel.model }}</dd></template>
          <template v-if="sel.firmware"><dt>Proshivka</dt><dd class="mono">{{ sel.firmware }}</dd></template>
          <template v-if="sel.serial"><dt>Seriya</dt><dd class="mono">{{ sel.serial }}</dd></template>
          <template v-if="sel.mac"><dt>MAC</dt><dd class="mono">{{ sel.mac }}</dd></template>
        </dl>

        <!-- Turi va izoh (qo'lda tuzatish mumkin) -->
        <div class="meta-row">
          <div>
            <label class="label" for="kd">Turi</label>
            <select id="kd" class="input" :value="sel.kind || ''" :disabled="savingMeta || sel.status === 'nvr_added' || sel.status === 'added'" @change="saveMeta({ kind: ($event.target as HTMLSelectElement).value || null })">
              <option value="">Nomaʼlum</option>
              <option value="camera">Kamera</option>
              <option value="nvr">NVR / DVR</option>
              <option value="other">Boshqa</option>
            </select>
            <p v-if="sel.kind && !kindLabel(sel).sure" class="hint">Skan taxmini — login/parol bilan ulangach aniqlanadi yoki qoʻlda tanlang.</p>
          </div>
          <div>
            <label class="label" for="nt">Izoh (qayerga tegishli)</label>
            <div class="name-row">
              <input id="nt" v-model="noteEdit" class="input" maxlength="120" placeholder="masalan: 3-bino, server xonasi" @keyup.enter="saveMeta({ note: noteEdit })" />
              <button class="btn btn-soft" :disabled="savingMeta || noteEdit === (sel.note || '')" @click="saveMeta({ note: noteEdit })">Saqlash</button>
            </div>
          </div>
        </div>

        <div v-if="sel.status !== 'new' && sel.status !== 'nvr_added'" class="snap">
          <img v-if="snap" :src="snap" :alt="`${sel.ip} — kameradan rasm`" />
          <span v-else>{{ snapLoading ? "Rasm olinmoqda…" : "Rasm olinmadi" }}</span>
        </div>

        <!-- NVR sifatida qo'shilgan -->
        <template v-if="sel.status === 'nvr_added'">
          <p v-if="connMsg" class="ok-text">{{ connMsg }}</p>
          <p class="ok-text">✓ NVR qurilmalarda: <strong>{{ sel.nvr_name }}</strong></p>
          <div class="actions">
            <NuxtLink to="/nvrs" class="btn btn-primary">NVR qurilmalar — kanallarni import qilish</NuxtLink>
          </div>
          <p class="hint">NVR kanallarini kamera qilish uchun «NVR qurilmalar» boʻlimida «Kanallar»ni oching.</p>
        </template>

        <!-- Kameralarga o'tkazilgan -->
        <template v-else-if="sel.status === 'added'">
          <p class="ok-text">✓ Kameralar roʻyxatida: <strong>{{ sel.camera_name }}</strong></p>
          <p v-if="promoMsg" class="ok-text">{{ promoMsg }}</p>
          <div class="actions">
            <NuxtLink :to="`/edit/${sel.camera_id}`" class="btn">Kamerani tahrirlash</NuxtLink>
            <NuxtLink to="/admin?src=scan" class="btn btn-soft">Kameralar roʻyxati</NuxtLink>
          </div>
        </template>

        <!-- Ulanish formasi -->
        <form v-else class="box" @submit.prevent="connect">
          <strong>{{ sel.status === "connected" ? "Ulangan ✓" : "1. Qurilmaga ulanish" }}</strong>
          <p v-if="sel.status !== 'connected'" class="small muted">
            Login/parol toʻgʻri kelsa, qurilma turi aniqlanadi. <strong>NVR/DVR</strong> boʻlsa oʻzi «NVR qurilmalar»ga qoʻshiladi; <strong>kamera</strong> boʻlsa pastda kameralarga oʻtkazasiz.
          </p>
          <p v-if="sel.status === 'connected'" class="small">
            {{ sel.login }} · {{ sel.codec?.toUpperCase() }} {{ sel.width }}×{{ sel.height }}
            · <span class="mono">/{{ sel.rtsp_path }}</span>
            <br />Boshqa login/parol bilan qayta ulanish uchun pastdagini toʻldiring.
          </p>
          <div class="row2">
            <div>
              <label class="label" for="cl">Login</label>
              <input id="cl" v-model="conn.login" class="input" autocomplete="off" />
            </div>
            <div>
              <label class="label" for="cp">Parol</label>
              <input id="cp" v-model="conn.parol" class="input" type="password" autocomplete="new-password" />
            </div>
          </div>
          <label class="check"><input v-model="conn.advanced" type="checkbox" /> RTSP port va yoʻlni qoʻlda koʻrsatish</label>
          <div v-if="conn.advanced" class="row2">
            <div>
              <label class="label" for="crp">RTSP port</label>
              <input id="crp" v-model.number="conn.rtspPort" class="input" type="number" min="1" max="65535" />
            </div>
            <div>
              <label class="label" for="cpath">RTSP yoʻli</label>
              <input id="cpath" v-model="conn.rtspPath" class="input mono" placeholder="Streaming/Channels/101" />
            </div>
          </div>
          <p v-if="connErr" class="err">{{ connErr }}</p>
          <button class="btn" :class="sel.status === 'connected' ? 'btn-soft' : 'btn-primary'" type="submit" :disabled="connecting || !conn.login || !conn.parol">
            {{ connecting ? "Ulanmoqda…" : sel.status === "connected" ? "Qayta ulanish" : "Ulanish" }}
          </button>
        </form>

        <!-- Kameralarga o'tkazish -->
        <form v-if="sel.status === 'connected'" class="box" @submit.prevent="promote">
          <strong>2. Kameralarga oʻtkazish</strong>
          <div>
            <label class="label" for="pn">Kamera nomi</label>
            <input id="pn" v-model="promo.name" class="input" maxlength="60" placeholder="masalan: 2.208-xona" />
          </div>
          <label class="check"><input v-model="promo.isPublic" type="checkbox" /> Mehmon sahifasida ochiq</label>
          <select v-if="groups.length" v-model="promo.groupId" class="input" aria-label="Guruh">
            <option value="">Guruhsiz</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">Guruhga: {{ g.name }}</option>
          </select>
          <p v-if="promoErr" class="err">{{ promoErr }}</p>
          <button class="btn btn-primary" type="submit" :disabled="promoting || !promo.name.trim() || !can('cameras.manage')">
            {{ promoting ? "Qoʻshilmoqda…" : "Kameralarga oʻtkazish" }}
          </button>
          <p v-if="!can('cameras.manage')" class="hint">Kamera qoʻshish uchun «Kameralarni boshqarish» huquqi kerak.</p>
        </form>

        <button class="btn btn-sm btn-danger del" @click="removeRow(sel)">Roʻyxatdan olib tashlash</button>
      </section>
      <section v-else-if="rows.length" class="edit panel empty">
        Roʻyxatdan qurilmani tanlang — login/parol bilan ulanib, kameralarga oʻtkazasiz.
      </section>
    </div>
  </section>
</template>

<style scoped>
.scan {
  margin-bottom: 24px;
}
.scan-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.scan-row .input {
  flex: 1 1 320px;
  min-width: 0;
}
.prog {
  height: 14px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 999px;
  overflow: hidden;
}
.prog-bar {
  height: 100%;
  background: var(--accent);
  transition: width 0.4s ease;
}
.warn-text {
  color: var(--warn-ink);
  background: var(--warn-soft);
  border: 1px solid var(--warn-line);
  border-radius: 10px;
  padding: 10px 14px;
  margin: 0;
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
  margin-bottom: 14px;
}
.list-tools .input {
  width: auto;
}
.grow {
  flex: 1 1 220px;
}
.grow .input {
  width: 100%;
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
.ipc {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.nm {
  font-weight: 700;
}
.ip {
  font-size: 15px;
  color: var(--muted);
}
.small {
  font-size: 15px;
}
.empty-note {
  font-size: 19px;
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
.sel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.sel-head h2 {
  margin: 2px 0 0;
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
.box {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel-2);
}
.box strong {
  font-size: 19px;
}
.kind {
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}
.k-nvr {
  color: var(--accent-dark);
}
.k-camera {
  color: var(--ok-ink);
}
.k-other {
  color: var(--muted);
}
.k-unknown {
  color: var(--muted);
  font-weight: 500;
}
.note {
  color: var(--accent-dark);
  font-style: italic;
}
.info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 14px;
  margin: 0;
  padding: 12px 14px;
  background: var(--panel-2);
  border-radius: 10px;
  font-size: 15px;
}
.info dt {
  color: var(--muted);
}
.info dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.meta-row {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 14px;
}
.meta-row .input {
  width: 100%;
}
.name-row {
  display: flex;
  gap: 8px;
}
.name-row .input {
  flex: 1;
  min-width: 0;
}
@media (max-width: 560px) {
  .meta-row {
    grid-template-columns: 1fr;
  }
}
.del {
  justify-self: start;
}
@media (max-width: 640px) {
  .list-tools > div,
  .list-tools .input {
    width: 100%;
  }
}
</style>
