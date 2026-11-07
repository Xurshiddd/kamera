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
  return [h && `${h} soat`, m && `${m} daqiqa`, s && `${s} soniya`].filter(Boolean).join(" ") || "0";
};
const today = todayIso;
const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
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
// Kun tugmalari ko'rsatilayotgan oy (sanadan alohida — oyni varaqlash mumkin).
const viewMonth = ref(date.value.slice(0, 7));
const monthDays = computed(() => {
  const [y, m] = viewMonth.value.split("-").map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`);
});
const monthLabel = computed(() => {
  const [y, m] = viewMonth.value.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
});
function shiftMonth(d: number) {
  const [y, m] = viewMonth.value.split("-").map(Number);
  const t = new Date(y, m - 1 + d, 1);
  viewMonth.value = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
}
const canNextMonth = computed(() => viewMonth.value < today().slice(0, 7));

async function loadDay() {
  if (!cameraId.value) return;
  router.replace({ query: { camera: cameraId.value, date: date.value } });
  loadingDay.value = true;
  dayError.value = "";
  ranges.value = [];
  try {
    const d = await call<{ ranges: Range[] }>(`/api/playback/${cameraId.value}/day`, { query: { date: date.value } });
    ranges.value = d.ranges.map((r) => ({ a: sod(r.start), b: r.end.slice(0, 10) > date.value ? DAY : sod(r.end) }));
  } catch (e: any) {
    dayError.value = e?.data?.error || "Yozuvlar ro'yxatini NVR'dan olib bo'lmadi.";
  } finally {
    loadingDay.value = false;
  }
}
async function loadMonth() {
  if (!cameraId.value) return;
  const month = viewMonth.value;
  days.value = [];
  const m = await call<{ days: string[] }>(`/api/playback/${cameraId.value}/days`, { query: { month } }).catch(() => null);
  if (m && month === viewMonth.value) days.value = m.days;
}

watch([cameraId, date], () => {
  stopSession();
  cursor.value = null;
  markA.value = null;
  markB.value = null;
  loadDay();
});
watch(date, (d) => (viewMonth.value = d.slice(0, 7)));
watch([cameraId, viewMonth], loadMonth);

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
      cursor.value = null;
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
    cursor.value = null;
    beatTimer = setInterval(() => {
      if (session.value) call(`/api/playback/sessions/${session.value.id}/beat`, { method: "POST" }).catch(() => {});
    }, 20000);
  } catch (e: any) {
    cursor.value = null;
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
const jump = (d: number) => play(head.value + d);

// --- Timeline ---
// Sariq tayoqcha (head) — ko'rish vaqti, doim ko'rinadi. Timeline'ni bosish yoki
// tayoqchani sudrash -> qo'yib yuborilganda o'sha vaqtdan o'ynaydi.
// Ko'k belgilar (markA/markB) — qirqish chegaralari; "[ Boshlanish" / "Tugash ]"
// tugmalari ularni yoqadi/o'chiradi, timeline'da sudrab aniq joyga qo'yiladi.
const bar = ref<HTMLElement | null>(null);
const hover = ref<number | null>(null);
const cursor = ref<number | null>(null); // sudralayotgan / o'ynatilmagan holatdagi head
const markA = ref<number | null>(null);
const markB = ref<number | null>(null);
const head = computed(() => cursor.value ?? playPos.value ?? ranges.value[0]?.a ?? 0);
const maxT = computed(() => (date.value === today() ? Math.min(DAY - 1, nowSod()) : DAY - 1));
let drag: "head" | "a" | "b" | null = null;

function tAt(clientX: number) {
  const r = bar.value!.getBoundingClientRect();
  return Math.round(Math.max(0, Math.min(DAY - 1, ((clientX - r.left) / r.width) * DAY)));
}
function setDragged(t: number) {
  t = Math.min(t, maxT.value);
  if (drag === "head") cursor.value = t;
  else if (drag === "a") markA.value = markB.value !== null ? Math.min(t, markB.value - 1) : t;
  else if (drag === "b") markB.value = markA.value !== null ? Math.max(t, markA.value + 1) : t;
}
function onDown(e: PointerEvent, what: "head" | "a" | "b" = "head") {
  if (e.button !== 0) return;
  bar.value!.setPointerCapture(e.pointerId);
  drag = what;
  if (what === "head") setDragged(tAt(e.clientX));
}
function onMove(e: PointerEvent) {
  hover.value = tAt(e.clientX);
  if (drag) setDragged(tAt(e.clientX));
}
function onUp() {
  const was = drag;
  drag = null;
  if (was === "head" && cursor.value !== null) play(cursor.value);
}
// Belgini klaviatura bilan siljitish: ←/→ 1 son, Shift bilan 10 son.
function onMarkKey(e: KeyboardEvent, what: "a" | "b") {
  const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
  if (!d) return;
  e.preventDefault();
  drag = what;
  setDragged((what === "a" ? markA.value! : markB.value!) + d * (e.shiftKey ? 10 : 1));
  drag = null;
}
const pct = (n: number) => `${(n / DAY) * 100}%`;

// --- Qirqish (eksport) ---
function toggleA() {
  if (markA.value !== null) return void (markA.value = null);
  // Belgi juda yaqin tushsa (ikkalasi bir joyda) — 10 daqiqa oraliq beramiz.
  let t = Math.round(Math.min(head.value, maxT.value));
  if (markB.value !== null && t > markB.value - 60) t = Math.max(0, markB.value - 600);
  markA.value = t;
}
function toggleB() {
  if (markB.value !== null) return void (markB.value = null);
  let t = Math.round(Math.min(head.value, maxT.value));
  if (markA.value !== null && t < markA.value + 60) t = Math.min(maxT.value, markA.value + 600);
  markB.value = t;
}
const sel = computed(() =>
  markA.value !== null && markB.value !== null && markB.value > markA.value ? { a: markA.value, b: markB.value } : null
);
const fromText = ref("");
const toText = ref("");
watch(markA, (v) => (fromText.value = v === null ? "" : hms(v)));
watch(markB, (v) => (toText.value = v === null ? "" : hms(v)));
function applyText(which: "a" | "b") {
  const txt = which === "a" ? fromText.value : toText.value;
  const target = which === "a" ? markA : markB;
  if (!txt.trim()) return void (target.value = null);
  const v = parseHms(txt);
  if (v !== null) target.value = v;
}
const selError = computed(() => {
  if (!fromText.value && !toText.value) return "";
  const a = parseHms(fromText.value), b = parseHms(toText.value);
  if ((fromText.value && a === null) || (toText.value && b === null)) return "Vaqtni SS:DD yoki SS:DD:SS ko'rinishida kiriting.";
  if (a === null || b === null) return "";
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

// Kunni oldinga/orqaga surish va to'liq nomi ("Shanba, 7-noyabr").
const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
function shiftDay(d: number) {
  const [y, m, dd] = date.value.split("-").map(Number);
  const t = new Date(y, m - 1, dd + d);
  const iso = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  if (iso <= today()) date.value = iso;
}
const dayLabel = computed(() => {
  const [y, m, d] = date.value.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  return `${WEEKDAYS[t.getDay()]}, ${d}-${MONTHS[m - 1].toLowerCase()}`;
});
const ticks = Array.from({ length: 13 }, (_, i) => i * 2);

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
  else {
    loadDay();
    loadMonth();
  }
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
        <ol class="steps">
          <li><span class="num">1</span>Xonani tanlang</li>
          <li><span class="num">2</span>Kunni tanlang</li>
          <li><span class="num">3</span>Vaqt chizigʻida kerakli soatni bosing</li>
        </ol>
      </div>
    </div>

    <div class="layout">
      <!-- Chap: xonalar -->
      <aside class="side panel">
        <label class="label" for="xona">Xona</label>
        <input id="xona" v-model="camQ" type="search" class="input" placeholder="Qidirish…" />
        <div class="cam-list">
          <button
            v-for="c in camList"
            :key="c.id"
            class="cam"
            :class="{ on: c.id === cameraId }"
            :aria-pressed="c.id === cameraId"
            @click="cameraId = c.id"
          >
            {{ c.name }}
          </button>
          <p v-if="!camList.length" class="muted">Yozuvli (NVR) kamera yoʻq.</p>
        </div>
      </aside>

      <div class="content">
        <!-- Kun -->
        <section class="panel" aria-label="Kun">
          <div class="date-row">
            <button class="btn sq" aria-label="Oldingi kun" @click="shiftDay(-1)">‹</button>
            <div class="day-title">
              <span class="dl">{{ dayLabel }}</span>
              <span class="ds">{{ fmtDate(date) }} · {{ camera?.name || "—" }}</span>
            </div>
            <button class="btn sq" aria-label="Keyingi kun" :disabled="date >= today()" @click="shiftDay(1)">›</button>
            <span class="spacer" />
            <label class="label inline" for="sana">Sana</label>
            <DateInput v-model="date" :max="today()" />
          </div>
          <div class="days">
            <div class="month-nav">
              <button class="btn btn-sm" aria-label="Oldingi oy" @click="shiftMonth(-1)">‹</button>
              <span class="month">{{ monthLabel }}</span>
              <button class="btn btn-sm" aria-label="Keyingi oy" :disabled="!canNextMonth" @click="shiftMonth(1)">›</button>
            </div>
            <button
              v-for="d in monthDays"
              :key="d"
              class="day"
              :class="{ has: days.includes(d), on: d === date }"
              :disabled="d > today()"
              :aria-current="d === date ? 'date' : undefined"
              :title="`${fmtDate(d)} — ${days.includes(d) ? 'yozuv bor' : 'yozuv yoʻq'}`"
              @click="date = d"
            >
              {{ Number(d.slice(8)) }}
            </button>
          </div>
          <p class="legend"><span class="sw sw-day" />Yashil — shu kuni yozuv bor</p>
        </section>

        <!-- Video va vaqt chizig'i -->
        <section class="panel" aria-label="Video">
          <div v-if="session" class="player-wrap">
            <ClientOnly>
              <HlsPlayer :key="session.id" :src="session.hls" vod @time="onTime" />
            </ClientOnly>
            <span class="osd">{{ fmtDate(date) }} · {{ hms(head) }}</span>
          </div>
          <div v-else class="player-ph">
            <span v-if="starting">Yozuv ochilmoqda…</span>
            <span v-else-if="loadingDay">NVR’dan yozuvlar olinmoqda…</span>
            <span v-else-if="ranges.length">Quyidagi vaqt chizigʻida kerakli soatni bosing</span>
            <span v-else>Bu kunda yozuv yoʻq</span>
          </div>
          <div class="ctrl">
            <button class="btn" :disabled="!ranges.length" @click="jump(-300)">« 5 daqiqa</button>
            <button class="btn" :disabled="!ranges.length" @click="jump(-60)">‹ 1 daqiqa</button>
            <span class="clock" title="Sariq chiziq vaqti">{{ hms(head) }}</span>
            <button class="btn" :disabled="!ranges.length" @click="jump(60)">1 daqiqa ›</button>
            <button class="btn" :disabled="!ranges.length" @click="jump(300)">5 daqiqa »</button>
          </div>
          <p v-if="playError" class="err">{{ playError }}</p>

          <div class="tl-head">
            <span class="tl-title">Vaqt chizigʻi — 24 soat</span>
            <span class="muted">Bosing yoki sariq chiziqni suring — oʻsha vaqtdan koʻrsatadi</span>
          </div>
          <div
            ref="bar"
            class="timeline"
            @pointerdown="onDown($event)"
            @pointermove="onMove"
            @pointerup="onUp"
            @pointercancel="onUp"
            @pointerleave="hover = null"
          >
            <div class="track">
              <div v-for="(r, i) in ranges" :key="i" class="rec" :style="{ left: pct(r.a), width: pct(r.b - r.a) }" />
              <div v-if="sel" class="sel" :style="{ left: pct(sel.a), width: pct(sel.b - sel.a) }" />
              <div v-for="h in 23" :key="`g${h}`" class="grid-line" :style="{ left: pct(h * 3600) }" />
            </div>
            <div v-if="hover !== null" class="hover" :style="{ left: pct(hover) }">
              <span>{{ hms(hover) }}</span>
            </div>
            <div
              v-if="markA !== null"
              class="mark mark-a"
              :style="{ left: pct(markA) }"
              tabindex="0"
              role="slider"
              aria-label="Boshlanish belgisi"
              :aria-valuetext="hms(markA)"
              title="Suring (← → 1 soniya, Shift bilan 10 soniya)"
              @pointerdown.stop="onDown($event, 'a')"
              @keydown="onMarkKey($event, 'a')"
            >
              <span class="flag">[ Boshlanish {{ hms(markA) }}</span>
            </div>
            <div
              v-if="markB !== null"
              class="mark mark-b"
              :style="{ left: pct(markB) }"
              tabindex="0"
              role="slider"
              aria-label="Tugash belgisi"
              :aria-valuetext="hms(markB)"
              title="Suring (← → 1 soniya, Shift bilan 10 soniya)"
              @pointerdown.stop="onDown($event, 'b')"
              @keydown="onMarkKey($event, 'b')"
            >
              <span class="flag">{{ hms(markB) }} Tugash ]</span>
            </div>
            <div class="head" :class="{ idle: !session }" :style="{ left: pct(head) }" @pointerdown.stop="onDown($event)">
              <span class="knob" />
            </div>
          </div>
          <div class="ticks">
            <span v-for="h in ticks" :key="h" :style="{ left: pct(h * 3600) }">{{ pad(h) }}</span>
          </div>
          <div class="legend-row">
            <span><span class="sw sw-rec" />Yozuv bor</span>
            <span><span class="sw sw-head" />Sariq — koʻrilayotgan vaqt</span>
            <span><span class="sw sw-mark" />Koʻk — qirqish chegaralari</span>
          </div>
          <p v-if="dayError" class="err">{{ dayError }}</p>
        </section>

        <!-- Qirqish -->
        <section v-if="can('playback.export')" class="panel" aria-labelledby="qirq">
          <div>
            <h2 id="qirq">Qirqib yuklab olish</h2>
            <p class="lead">
              Sariq chiziqni kerakli joyga qoʻying va tugmani bosing. Koʻk belgini surib aniqlashtirish mumkin.
              Qayta bosilsa — belgi oʻchadi.
            </p>
          </div>
          <div class="marks">
            <button
              class="mark-btn"
              :class="{ on: markA !== null }"
              :aria-pressed="markA !== null"
              :disabled="!ranges.length"
              @click="toggleA"
            >
              <template v-if="markA !== null">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
                [ Boshlanish: {{ hms(markA) }}
              </template>
              <template v-else>[ Boshlanishni belgilash</template>
            </button>
            <button
              class="mark-btn"
              :class="{ on: markB !== null }"
              :aria-pressed="markB !== null"
              :disabled="!ranges.length"
              @click="toggleB"
            >
              <template v-if="markB !== null">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
                Tugash: {{ hms(markB) }} ]
              </template>
              <template v-else>Tugashni belgilash ]</template>
            </button>
          </div>

          <details class="manual">
            <summary>Vaqtni qoʻlda yozish</summary>
            <div class="cut-row">
              <div>
                <label class="label" for="from">Boshlanish</label>
                <input id="from" v-model="fromText" class="input mono" placeholder="10:15:00" @change="applyText('a')" />
              </div>
              <div>
                <label class="label" for="to">Tugash</label>
                <input id="to" v-model="toText" class="input mono" placeholder="11:35:00" @change="applyText('b')" />
              </div>
            </div>
          </details>
          <p v-if="selError" class="err">{{ selError }}</p>

          <div v-if="sel && !selError" class="summary">
            <div class="sum-text">
              <span class="sum-label">Tanlangan qism</span>
              <span class="sum-main">{{ hms(sel.a).slice(0, 5) }} – {{ hms(sel.b).slice(0, 5) }} · {{ dur(sel.b - sel.a) }}</span>
              <span class="muted">
                <template v-if="selCovered >= sel.b - sel.a">Butun qismda yozuv bor</template>
                <template v-else-if="selCovered">Yozuv bor: {{ dur(selCovered) }} (oraligʻida boʻshliq bor)</template>
                <template v-else>Bu qismda yozuv yoʻq</template>
              </span>
            </div>
            <button class="btn btn-primary go" :disabled="exporting || !selCovered" @click="doExport">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="7" r="3" /><circle cx="6" cy="17" r="3" /><path d="M8.5 8.5L20 18" /><path d="M8.5 15.5L20 6" /></svg>
              {{ exporting ? "Boshlanmoqda…" : "Videoni tayyorlash" }}
            </button>
          </div>
          <p v-else-if="!selError" class="placeholder">
            Ikkala belgi qoʻyilgach, bu yerda «Videoni tayyorlash» tugmasi chiqadi.
          </p>
          <p v-if="exportError" class="err">{{ exportError }}</p>

          <div v-if="jobs.length" class="jobs">
            <h3>Tayyorlanayotgan videolar</h3>
            <div v-for="j in jobs" :key="j.id" class="job" :class="{ done: j.status === 'done' }">
              <div class="job-main">
                <span class="job-title">
                  {{ j.cameraName }} · {{ fmtDate(j.start) }} · {{ j.start.slice(11, 16) }}–{{ j.end.slice(11, 16) }}
                </span>
                <span v-if="j.status === 'queued'" class="muted">Navbatda…</span>
                <div
                  v-else-if="j.status === 'running'"
                  class="prog"
                  role="progressbar"
                  :aria-valuenow="Math.round(j.progress * 100)"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div class="prog-bar" :style="{ width: `${Math.round(j.progress * 100)}%` }" />
                  <span>{{ Math.round(j.progress * 100) }}%</span>
                </div>
                <span v-else-if="j.status === 'done'" class="done-text">Tayyor · 2 soat ichida yuklab oling</span>
                <span v-else-if="j.status === 'error'" class="err">{{ j.error }}</span>
              </div>
              <a v-if="j.status === 'done'" class="btn btn-ok" :href="fileUrl(j)" :download="j.filename">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></svg>
                Yuklab olish ({{ mb(j.size) }})
              </a>
              <button class="btn btn-danger" @click="removeJob(j)">
                {{ j.status === "running" || j.status === "queued" ? "Bekor qilish" : "Oʻchirish" }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.steps {
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 28px;
  font-size: 19px;
  color: #374151;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 10px;
}
.num {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #dbeafe;
  color: var(--accent-dark);
  font-weight: 700;
  display: grid;
  place-items: center;
}
.layout {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  align-items: flex-start;
}
.side {
  flex: 1 1 260px;
  max-width: 320px;
  gap: 10px;
}
@media (max-width: 900px) {
  .side {
    max-width: none;
  }
}
.side .label {
  margin: 0;
  font-size: 19px;
}
.cam-list {
  display: grid;
  gap: 6px;
  max-height: 70vh;
  overflow: auto;
}
.cam {
  min-height: 52px;
  text-align: left;
  padding: 0 16px;
  font: inherit;
  font-size: 19px;
  color: var(--text);
  background: var(--panel);
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  cursor: pointer;
}
.cam:hover {
  background: var(--panel-2);
}
.cam.on {
  color: var(--accent-ink);
  background: var(--accent);
  border-color: var(--accent);
  font-weight: 700;
}
.content {
  flex: 999 1 560px;
  min-width: 0;
}
.date-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
}
.sq {
  width: 56px;
  padding: 0;
  font-size: 26px;
}
.day-title {
  display: flex;
  flex-direction: column;
  min-width: 240px;
}
.dl {
  font-size: 26px;
  font-weight: 700;
}
.ds {
  font-size: 17px;
  color: var(--muted);
}
.spacer {
  flex: 1;
}
.label.inline {
  margin: 0;
}
.days {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.month-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 8px;
}
.month {
  min-width: 132px;
  text-align: center;
  font-weight: 700;
}
.day {
  width: 48px;
  height: 48px;
  font: inherit;
  font-size: 18px;
  color: var(--muted);
  background: var(--panel);
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  cursor: pointer;
}
.day.has {
  color: var(--ok-ink);
  background: var(--ok-soft);
  border-color: var(--ok-line);
  font-weight: 600;
}
.day.on {
  color: var(--accent-ink);
  background: var(--accent);
  border-color: var(--accent);
  font-weight: 700;
}
.day:disabled {
  color: #9ca3af;
  background: #f9fafb;
  border-color: #f3f4f6;
  cursor: default;
}
.legend,
.legend-row {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
  font-size: 17px;
  color: #374151;
}
.legend-row > span,
.legend {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sw {
  display: inline-block;
  flex: none;
}
.sw-day {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: var(--ok-soft);
  border: 2px solid var(--ok-line);
}
.sw-rec {
  width: 22px;
  height: 14px;
  border-radius: 3px;
  background: #22c55e;
}
.sw-head {
  width: 4px;
  height: 20px;
  background: var(--head);
  box-shadow: 0 0 0 1px #78350f;
}
.sw-mark {
  width: 3px;
  height: 20px;
  background: var(--accent-dark);
}
.player-wrap {
  position: relative;
}
.osd {
  position: absolute;
  top: 14px;
  left: 14px;
  padding: 6px 12px;
  font-size: 19px;
  font-weight: 700;
  color: #ffffff;
  background: rgba(17, 24, 39, 0.8);
  border-radius: 8px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  z-index: 3;
}
.player-ph {
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  padding: 20px;
  text-align: center;
  background: #1f2937;
  border-radius: 10px;
  color: #f9fafb;
  font-size: 22px;
}
.ctrl {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: center;
}
.clock {
  font-size: 30px;
  font-weight: 700;
  min-width: 150px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.tl-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 4px 16px;
  margin-top: 6px;
}
.tl-title {
  font-size: 20px;
  font-weight: 700;
}
.timeline {
  position: relative;
  height: 64px;
  margin-top: 30px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}
.track {
  position: absolute;
  inset: 0;
  background: var(--panel-2);
  border: 2px solid var(--line-strong);
  border-radius: 10px;
  overflow: hidden;
}
.rec {
  position: absolute;
  top: 10px;
  bottom: 10px;
  background: #22c55e;
  border-radius: 3px;
  pointer-events: none;
}
.sel {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(29, 78, 216, 0.3);
  pointer-events: none;
}
.grid-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(17, 24, 39, 0.12);
  pointer-events: none;
}
.head {
  position: absolute;
  top: -10px;
  bottom: -4px;
  width: 22px;
  margin-left: -11px;
  cursor: ew-resize;
  z-index: 3;
}
.head::before {
  content: "";
  position: absolute;
  left: 9px;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--head);
  box-shadow: 0 0 0 1px #78350f;
}
.head .knob {
  position: absolute;
  left: 0;
  top: -2px;
  width: 0;
  height: 0;
  border-left: 11px solid transparent;
  border-right: 11px solid transparent;
  border-top: 13px solid var(--head);
}
.mark {
  position: absolute;
  top: -30px;
  bottom: 0;
  width: 16px;
  margin-left: -8px;
  cursor: ew-resize;
  z-index: 2;
  outline: none;
}
.mark::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent-dark);
}
.mark .flag {
  position: absolute;
  top: 0;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: var(--accent-dark);
  color: #ffffff;
  padding: 3px 9px;
  border-radius: 6px;
  white-space: nowrap;
}
/* Yorliqlar tashqariga qaraydi — belgilar yaqin bo'lsa ham bir-birini yopmaydi */
.mark-a .flag {
  right: 7px;
  border-bottom-right-radius: 0;
}
.mark-b .flag {
  left: 9px;
  border-bottom-left-radius: 0;
}
.mark:focus-visible .flag {
  box-shadow: 0 0 0 3px #93c5fd;
}
.hover {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(17, 24, 39, 0.45);
  pointer-events: none;
  z-index: 1;
}
.hover span {
  position: absolute;
  bottom: 4px;
  left: 6px;
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
  background: #374151;
  padding: 1px 6px;
  border-radius: 5px;
  white-space: nowrap;
}
.ticks {
  position: relative;
  height: 26px;
  margin-top: 6px;
  font-size: 17px;
  font-weight: 600;
  color: #374151;
  font-variant-numeric: tabular-nums;
}
.ticks span {
  position: absolute;
  transform: translateX(-50%);
}
.ticks span:first-child {
  transform: none;
}
.ticks span:last-child {
  transform: translateX(-100%);
}
.lead {
  margin: 6px 0 0;
  font-size: 18px;
  color: #374151;
}
.marks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
}
.mark-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 64px;
  font: inherit;
  font-size: 21px;
  font-weight: 700;
  color: var(--accent-dark);
  background: var(--panel);
  border: 3px solid var(--accent);
  border-radius: 12px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.mark-btn.on {
  color: #ffffff;
  background: var(--accent-dark);
  border-color: var(--accent-dark);
  box-shadow: 0 0 0 4px var(--accent-soft-line);
}
.mark-btn:disabled {
  color: #9ca3af;
  border-color: #e5e7eb;
  cursor: default;
}
.manual summary {
  cursor: pointer;
  font-size: 18px;
  font-weight: 600;
  color: var(--accent-dark);
  min-height: 44px;
  display: flex;
  align-items: center;
}
.cut-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 200px));
  gap: 14px;
  margin-top: 8px;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 24px;
  padding: 18px 20px;
  background: var(--accent-soft);
  border: 2px solid var(--accent-soft-line);
  border-radius: 12px;
}
.sum-text {
  flex: 1 1 300px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sum-label {
  color: var(--accent-dark);
}
.sum-main {
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.go {
  min-height: 64px;
  font-size: 21px;
  padding: 0 28px;
}
.placeholder {
  margin: 0;
  padding: 16px 18px;
  color: #374151;
  background: #f9fafb;
  border: 2px dashed var(--line);
  border-radius: 12px;
}
.jobs {
  display: grid;
  gap: 12px;
}
.jobs h3 {
  margin: 8px 0 0;
  font-size: 21px;
}
.job {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  padding: 16px 18px;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
}
.job.done {
  border-color: var(--ok-line);
  background: #f0fdf4;
}
.job-main {
  flex: 1 1 320px;
  display: grid;
  gap: 8px;
  min-width: 0;
}
.job-title {
  font-size: 19px;
  font-weight: 600;
}
.done-text {
  color: var(--ok-ink);
}
.prog {
  position: relative;
  height: 28px;
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
.prog span {
  position: relative;
  padding-left: 12px;
  line-height: 28px;
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
}
.mono {
  font-variant-numeric: tabular-nums;
}
</style>
