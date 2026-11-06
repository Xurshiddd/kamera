<script setup lang="ts">
definePageMeta({ permission: "playback.view" });

// Vaqtlar NVR'ning mahalliy vaqti: "YYYY-MM-DDTHH:MM:SS" satrlar. Kun ichida
// hisoblash uchun "kun boshidan sekund" (0..86399) ishlatiladi.
interface MyCamera { id: number; name: string; playback: boolean }
interface Range { start: string; end: string }
interface Job {
  id: string;
  cameraName: string;
  start: string;
  end: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  size: number | null;
  error: string | null;
  filename: string;
  downloadKey?: string;
}

const { call } = useApi();
const { can } = useAuth();
const route = useRoute();
const router = useRouter();

const DAY = 86400;
const pad = (n: number) => String(n).padStart(2, "0");
const sod = (s: string) => Number(s.slice(11, 13)) * 3600 + Number(s.slice(14, 16)) * 60 + Number(s.slice(17, 19));
const hms = (n: number) => {
  n = Math.max(0, Math.min(DAY - 1, Math.round(n)));
  return `${pad(Math.floor(n / 3600))}:${pad(Math.floor((n % 3600) / 60))}:${pad(n % 60)}`;
};
const parseHms = (s: string): number | null => {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const v = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  return Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3] || 0) < 60 ? v : null;
};
const dur = (n: number) => {
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60;
  return [h && `${h} soat`, m && `${m} daq`, s && `${s} son`].filter(Boolean).join(" ") || "0";
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const nowSod = () => {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
};

// --- Kamera va sana ---
const cameras = ref<MyCamera[]>([]);
const camQ = ref("");
const cameraId = ref<number | null>(Number(route.query.camera) || null);
const date = ref<string>((route.query.date as string) || today());
const days = ref<string[]>([]);
const ranges = ref<{ a: number; b: number }[]>([]);
const loadingDay = ref(false);
const dayError = ref("");

const camList = computed(() => {
  const s = camQ.value.trim().toLowerCase();
  return cameras.value.filter((c) => c.playback && (!s || c.name.toLowerCase().includes(s)));
});
const camera = computed(() => cameras.value.find((c) => c.id === cameraId.value) || null);
const recorded = computed(() => ranges.value.reduce((t, r) => t + (r.b - r.a), 0));
const monthDays = computed(() => {
  const [y, m] = date.value.split("-").map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`);
});

async function loadDay() {
  if (!cameraId.value) return;
  router.replace({ query: { camera: cameraId.value, date: date.value } });
  loadingDay.value = true;
  dayError.value = "";
  ranges.value = [];
  try {
    const [d, m] = await Promise.all([
      call<{ ranges: Range[] }>(`/api/playback/${cameraId.value}/day`, { query: { date: date.value } }),
      call<{ days: string[] }>(`/api/playback/${cameraId.value}/days`, { query: { month: date.value.slice(0, 7) } }),
    ]);
    ranges.value = d.ranges.map((r) => ({ a: sod(r.start), b: r.end.slice(0, 10) > date.value ? DAY : sod(r.end) }));
    days.value = m.days;
  } catch (e: any) {
    dayError.value = e?.data?.error || "Yozuvlar ro'yxatini NVR'dan olib bo'lmadi.";
  } finally {
    loadingDay.value = false;
  }
}

watch([cameraId, date], () => {
  stopSession();
  sel.value = null;
  loadDay();
});

// --- Ko'rish sessiyasi ---
const session = ref<{ id: string; hls: string; startSod: number } | null>(null);
const playPos = ref<number | null>(null); // joriy ko'rsatilayotgan sekund (kun ichida)
const starting = ref(false);
const playError = ref("");
let beatTimer: ReturnType<typeof setInterval> | null = null;

async function play(at: number) {
  if (!cameraId.value) return;
  at = Math.max(0, Math.min(DAY - 5, Math.floor(at)));
  // Yozuv yo'q joy bosilsa — keyingi yozuv boshiga o'tamiz.
  if (!ranges.value.some((r) => at >= r.a && at < r.b)) {
    const next = ranges.value.find((r) => r.a > at);
    if (!next) {
      playError.value = "Bu vaqtdan keyin yozuv yo'q.";
      return;
    }
    at = next.a;
  }
  starting.value = true;
  playError.value = "";
  try {
    const s = await call<{ id: string; hls: string }>("/api/playback/sessions", {
      method: "POST",
      body: { cameraId: cameraId.value, start: `${date.value}T${hms(at)}` },
    });
    stopBeat();
    session.value = { id: s.id, hls: s.hls, startSod: at };
    playPos.value = at;
    beatTimer = setInterval(() => {
      if (session.value) call(`/api/playback/sessions/${session.value.id}/beat`, { method: "POST" }).catch(() => {});
    }, 20000);
  } catch (e: any) {
    playError.value = e?.data?.error || "Yozuvni ochib bo'lmadi.";
  } finally {
    starting.value = false;
  }
}

function onTime(t: number) {
  if (session.value) playPos.value = session.value.startSod + t;
}

function stopBeat() {
  if (beatTimer) clearInterval(beatTimer);
  beatTimer = null;
}
function stopSession() {
  stopBeat();
  if (session.value) call(`/api/playback/sessions/${session.value.id}`, { method: "DELETE" }).catch(() => {});
  session.value = null;
  playPos.value = null;
}
const jump = (d: number) => play((playPos.value ?? 0) + d);

// --- Timeline: bosish = shu joydan ko'rish, sudrash = oraliq belgilash ---
const bar = ref<HTMLElement | null>(null);
const sel = ref<{ a: number; b: number } | null>(null);
const hover = ref<number | null>(null);
let drag: { x0: number; t0: number; moved: boolean } | null = null;

function tAt(clientX: number) {
  const r = bar.value!.getBoundingClientRect();
  return Math.max(0, Math.min(DAY, ((clientX - r.left) / r.width) * DAY));
}
function onDown(e: PointerEvent) {
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  drag = { x0: e.clientX, t0: tAt(e.clientX), moved: false };
}
function onMove(e: PointerEvent) {
  hover.value = tAt(e.clientX);
  if (!drag) return;
  if (Math.abs(e.clientX - drag.x0) > 4) drag.moved = true;
  if (drag.moved) {
    const t = tAt(e.clientX);
    sel.value = { a: Math.floor(Math.min(drag.t0, t)), b: Math.ceil(Math.max(drag.t0, t)) };
  }
}
function onUp(e: PointerEvent) {
  if (drag && !drag.moved) play(tAt(e.clientX));
  drag = null;
}
const pct = (n: number) => `${(n / DAY) * 100}%`;

// --- Qirqish (eksport) ---
const fromText = ref("");
const toText = ref("");
watch(sel, (s) => {
  if (s) {
    fromText.value = hms(s.a);
    toText.value = hms(s.b);
  }
});
function syncSelFromInputs() {
  const a = parseHms(fromText.value);
  const b = parseHms(toText.value);
  sel.value = a !== null && b !== null && b > a ? { a, b } : null;
}
function markFrom() {
  if (playPos.value === null) return;
  fromText.value = hms(playPos.value);
  syncSelFromInputs();
}
function markTo() {
  if (playPos.value === null) return;
  toText.value = hms(playPos.value);
  syncSelFromInputs();
}
const selError = computed(() => {
  if (!fromText.value && !toText.value) return "";
  const a = parseHms(fromText.value), b = parseHms(toText.value);
  if (a === null || b === null) return "Vaqtni SS:DD yoki SS:DD:SS ko'rinishida kiriting.";
  if (b <= a) return "Tugash vaqti boshlanishdan keyin bo'lsin.";
  if (date.value === today() && b > nowSod()) return "Tugash vaqti hali kelmagan.";
  return "";
});
// Tanlangan oraliqning qancha qismida yozuv bor.
const selCovered = computed(() => {
  if (!sel.value) return 0;
  const { a, b } = sel.value;
  return ranges.value.reduce((t, r) => t + Math.max(0, Math.min(b, r.b) - Math.max(a, r.a)), 0);
});

const jobs = ref<Job[]>([]);
const exporting = ref(false);
const exportError = ref("");
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function loadJobs() {
  if (!can("playback.export")) return;
  jobs.value = await call<Job[]>("/api/playback/exports").catch(() => jobs.value);
  const busy = jobs.value.some((j) => j.status === "queued" || j.status === "running");
  if (busy && !pollTimer) pollTimer = setInterval(loadJobs, 1500);
  if (!busy && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function doExport() {
  syncSelFromInputs();
  if (!sel.value || selError.value || !cameraId.value) return;
  exporting.value = true;
  exportError.value = "";
  try {
    await call("/api/playback/exports", {
      method: "POST",
      body: {
        cameraId: cameraId.value,
        start: `${date.value}T${hms(sel.value.a)}`,
        end: `${date.value}T${hms(sel.value.b)}`,
      },
    });
    await loadJobs();
  } catch (e: any) {
    exportError.value = e?.data?.error || "Yuklab olishni boshlab bo'lmadi.";
  } finally {
    exporting.value = false;
  }
}

async function removeJob(j: Job) {
  await call(`/api/playback/exports/${j.id}`, { method: "DELETE" }).catch(() => {});
  await loadJobs();
}

const base = useRuntimeConfig().public.serviceBase as string;
const fileUrl = (j: Job) => `${base}/api/playback/exports/${j.id}/file?key=${j.downloadKey}`;
const mb = (n: number | null) => (n ? `${(n / 1048576).toFixed(n > 1e8 ? 0 : 1)} MB` : "");

onMounted(async () => {
  try {
    cameras.value = await call<MyCamera[]>("/api/me/cameras");
  } catch {
    dayError.value = "Kameralar ro'yxatini olib bo'lmadi.";
  }
  if (!cameraId.value) cameraId.value = camList.value[0]?.id ?? null;
  else loadDay();
  loadJobs();
});
onBeforeUnmount(() => {
  stopSession();
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h1>Yozuvlar</h1>
        <p class="sub">
          Sanani tanlang. Timeline'ni bosing — o'sha vaqtdan ko'rasiz; sichqoncha bilan sudrab
          oraliq belgilang — qirqib yuklab olasiz.
        </p>
      </div>
    </div>

    <div class="layout">
      <!-- Chap: kameralar -->
      <aside class="side panel">
        <input v-model="camQ" class="input" placeholder="Kamera qidirish…" />
        <div class="cam-list">
          <button
            v-for="c in camList"
            :key="c.id"
            class="cam"
            :class="{ on: c.id === cameraId }"
            @click="cameraId = c.id"
          >
            {{ c.name }}
          </button>
          <p v-if="!camList.length" class="muted small">Yozuvli (NVR) kamera yo'q.</p>
        </div>
      </aside>

      <!-- O'ng: sana, pleyer, timeline, qirqish -->
      <div class="content">
        <div class="panel date-panel">
          <div class="date-row">
            <strong>{{ camera?.name || "—" }}</strong>
            <input v-model="date" class="input date" type="date" :max="today()" />
            <span v-if="!loadingDay && ranges.length" class="muted small">
              yozuv: {{ dur(recorded) }}
            </span>
          </div>
          <div class="days">
            <button
              v-for="d in monthDays"
              :key="d"
              class="day"
              :class="{ has: days.includes(d), on: d === date }"
              :disabled="d > today()"
              :title="days.includes(d) ? 'Yozuv bor' : 'Yozuv yo\'q'"
              @click="date = d"
            >
              {{ Number(d.slice(8)) }}
            </button>
          </div>
        </div>

        <div class="panel player-panel">
          <div v-if="session" class="player-wrap">
            <ClientOnly>
              <HlsPlayer :key="session.id" :src="session.hls" vod @time="onTime" />
            </ClientOnly>
          </div>
          <div v-else class="player-ph">
            <span v-if="starting">Yozuv ochilmoqda…</span>
            <span v-else-if="loadingDay">NVR'dan yozuvlar olinmoqda…</span>
            <span v-else-if="ranges.length">Timeline'dagi vaqtni bosing</span>
            <span v-else>Bu kunda yozuv yo'q</span>
          </div>
          <div class="ctrl">
            <button class="btn btn-sm" :disabled="!session" @click="jump(-300)">« 5 daq</button>
            <button class="btn btn-sm" :disabled="!session" @click="jump(-60)">‹ 1 daq</button>
            <span class="clock mono">{{ playPos !== null ? hms(playPos) : "--:--:--" }}</span>
            <button class="btn btn-sm" :disabled="!session" @click="jump(60)">1 daq ›</button>
            <button class="btn btn-sm" :disabled="!session" @click="jump(300)">5 daq »</button>
            <span class="spacer" />
            <template v-if="can('playback.export')">
              <button class="btn btn-sm" :disabled="playPos === null" @click="markFrom">[ Boshlanish</button>
              <button class="btn btn-sm" :disabled="playPos === null" @click="markTo">Tugash ]</button>
            </template>
          </div>
          <p v-if="playError" class="err small">{{ playError }}</p>
        </div>

        <div class="panel">
          <div
            ref="bar"
            class="timeline"
            @pointerdown="onDown"
            @pointermove="onMove"
            @pointerup="onUp"
            @pointerleave="hover = null"
          >
            <div v-for="(r, i) in ranges" :key="i" class="rec" :style="{ left: pct(r.a), width: pct(r.b - r.a) }" />
            <div v-if="sel" class="sel" :style="{ left: pct(sel.a), width: pct(sel.b - sel.a) }" />
            <div v-if="playPos !== null" class="head" :style="{ left: pct(playPos) }" />
            <div v-if="hover !== null" class="hover" :style="{ left: pct(hover) }">
              <span>{{ hms(hover) }}</span>
            </div>
          </div>
          <div class="ticks">
            <span v-for="h in 25" :key="h" :style="{ left: pct((h - 1) * 3600) }">
              {{ (h - 1) % 3 === 0 ? pad(h - 1) : "" }}
            </span>
          </div>
          <p v-if="dayError" class="err small">{{ dayError }}</p>
        </div>

        <div v-if="can('playback.export')" class="panel">
          <strong>Qirqib yuklab olish</strong>
          <div class="cut-row">
            <div>
              <label class="label">Boshlanish</label>
              <input v-model="fromText" class="input mono" placeholder="10:15:00" @change="syncSelFromInputs" />
            </div>
            <div>
              <label class="label">Tugash</label>
              <input v-model="toText" class="input mono" placeholder="11:35:00" @change="syncSelFromInputs" />
            </div>
            <div class="cut-info">
              <template v-if="sel && !selError">
                <div><strong>{{ dur(sel.b - sel.a) }}</strong></div>
                <div class="muted small">
                  yozuv bor: {{ dur(selCovered) }}
                  <span v-if="selCovered < sel.b - sel.a">(oraliqda bo'shliq bor)</span>
                </div>
              </template>
            </div>
            <button
              class="btn btn-primary"
              :disabled="!sel || !!selError || exporting || !selCovered"
              @click="doExport"
            >
              {{ exporting ? "Boshlanmoqda…" : "MP4 tayyorlash" }}
            </button>
          </div>
          <p v-if="selError" class="err small">{{ selError }}</p>
          <p v-if="exportError" class="err small">{{ exportError }}</p>
          <p class="hint">
            Oraliqni timeline'da sudrab, vaqtni qo'lda yozib yoki pleyerdagi "[ Boshlanish" / "Tugash ]"
            tugmalari bilan belgilang. Fayl serverda 2 soat saqlanadi.
          </p>

          <div v-if="jobs.length" class="jobs">
            <div v-for="j in jobs" :key="j.id" class="job">
              <div class="job-main">
                <div>
                  <strong>{{ j.cameraName }}</strong>
                  <span class="muted small mono">
                    {{ j.start.slice(0, 10) }} {{ j.start.slice(11) }}–{{ j.end.slice(11) }}
                  </span>
                </div>
                <div v-if="j.status === 'queued'" class="muted small">Navbatda…</div>
                <div v-else-if="j.status === 'running'" class="prog">
                  <div class="prog-bar" :style="{ width: `${Math.round(j.progress * 100)}%` }" />
                  <span>{{ Math.round(j.progress * 100) }}%</span>
                </div>
                <div v-else-if="j.status === 'error'" class="err small">{{ j.error }}</div>
              </div>
              <a v-if="j.status === 'done'" class="btn btn-sm btn-primary" :href="fileUrl(j)" :download="j.filename">
                Yuklab olish ({{ mb(j.size) }})
              </a>
              <button class="btn btn-sm" @click="removeJob(j)">
                {{ j.status === "running" || j.status === "queued" ? "Bekor qilish" : "O'chirish" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 16px;
  align-items: start;
}
@media (max-width: 800px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
.panel {
  margin-bottom: 14px;
}
.side {
  position: sticky;
  top: 70px;
  gap: 10px;
}
.cam-list {
  display: grid;
  gap: 4px;
  max-height: 65vh;
  overflow: auto;
}
.cam {
  text-align: left;
  background: none;
  border: 1px solid transparent;
  color: var(--text);
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
.cam:hover {
  background: var(--panel-2);
}
.cam.on {
  border-color: var(--accent);
  color: var(--accent);
}
.content {
  min-width: 0;
}
.date-panel {
  gap: 10px;
}
.date-row {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.date {
  width: auto;
}
.days {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.day {
  width: 30px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
}
.day.has {
  color: var(--text);
  border-color: rgba(63, 185, 80, 0.5);
  background: rgba(63, 185, 80, 0.1);
}
.day.on {
  border-color: var(--accent);
  background: var(--accent);
  color: #04212f;
  font-weight: 600;
}
.day:disabled {
  opacity: 0.35;
  cursor: default;
}
.player-panel {
  gap: 10px;
}
.player-ph {
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  background: #000;
  border-radius: 10px;
  color: var(--muted);
}
.ctrl {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.clock {
  font-size: 18px;
  font-weight: 600;
  min-width: 96px;
  text-align: center;
}
.spacer {
  flex: 1;
}
.timeline {
  position: relative;
  height: 44px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 8px;
  cursor: crosshair;
  touch-action: none;
  user-select: none;
  overflow: hidden;
}
.rec {
  position: absolute;
  top: 8px;
  bottom: 8px;
  background: rgba(63, 185, 80, 0.55);
  border-radius: 3px;
  pointer-events: none;
}
.sel {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(76, 194, 255, 0.28);
  border-left: 2px solid var(--accent);
  border-right: 2px solid var(--accent);
  pointer-events: none;
}
.head {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--warn);
  pointer-events: none;
}
.hover {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.4);
  pointer-events: none;
}
.hover span {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 11px;
  background: var(--panel-2);
  padding: 0 4px;
  border-radius: 4px;
  white-space: nowrap;
}
.ticks {
  position: relative;
  height: 16px;
  font-size: 11px;
  color: var(--muted);
}
.ticks span {
  position: absolute;
  transform: translateX(-50%);
}
.cut-row {
  display: grid;
  grid-template-columns: 130px 130px 1fr auto;
  gap: 12px;
  align-items: end;
}
@media (max-width: 700px) {
  .cut-row {
    grid-template-columns: 1fr 1fr;
  }
}
.jobs {
  display: grid;
  gap: 8px;
}
.job {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
}
.job-main {
  flex: 1;
  display: grid;
  gap: 6px;
  min-width: 0;
}
.prog {
  position: relative;
  height: 18px;
  background: var(--bg);
  border-radius: 6px;
  overflow: hidden;
  font-size: 11px;
}
.prog-bar {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent);
  opacity: 0.6;
  transition: width 0.4s;
}
.prog span {
  position: relative;
  padding-left: 6px;
  line-height: 18px;
}
.mono {
  font-family: ui-monospace, monospace;
}
.small {
  font-size: 12px;
}
</style>
