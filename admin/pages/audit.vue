<script setup lang="ts">
definePageMeta({ permission: "audit.view" });

interface Row {
  id: number;
  username: string | null;
  action: string;
  camera_name: string | null;
  details: any;
  ip: string | null;
  created_at: string;
}

const ACTIONS: Record<string, string> = {
  login: "Kirish",
  "login.fail": "Muvaffaqiyatsiz kirish",
  "me.password": "Parolni almashtirdi",
  "playback.view": "Yozuvni ko'rdi",
  "playback.export": "Klip yuklab oldi",
  "camera.create": "Kamera qo'shdi",
  "camera.update": "Kamerani tahrirladi",
  "camera.delete": "Kamerani o'chirdi",
  "user.create": "Foydalanuvchi qo'shdi",
  "user.update": "Foydalanuvchini tahrirladi",
  "user.delete": "Foydalanuvchini o'chirdi",
  "role.create": "Rol qo'shdi",
  "role.update": "Rolni tahrirladi",
  "role.delete": "Rolni o'chirdi",
  "group.create": "Guruh qo'shdi",
  "group.update": "Guruhni tahrirladi",
  "group.delete": "Guruhni o'chirdi",
  "nvr.create": "NVR qo'shdi",
  "nvr.update": "NVR'ni tahrirladi",
  "nvr.delete": "NVR'ni o'chirdi",
  "nvr.import": "NVR kanallarini import qildi",
};

const { call } = useApi();
const route = useRoute();
const router = useRouter();

const rows = ref<Row[]>([]);
const loading = ref(false);
const error = ref("");
const total = ref(0);
const pages = ref(1);
const page = ref(Number(route.query.page) || 1);
const limit = ref(Number(route.query.limit) || 50);
const f = reactive({ user: "", action: "", fromDate: "", fromTime: "", toDate: "", toTime: "" });

async function load(p = page.value) {
  loading.value = true;
  error.value = "";
  try {
    const query: Record<string, any> = { page: p, limit: limit.value };
    if (f.user) query.user = f.user.trim();
    if (f.action) query.action = f.action;
    if (f.fromDate) query.from = toUtc(f.fromDate, f.fromTime || "00:00", 0);
    if (f.toDate) query.to = toUtc(f.toDate, f.toTime || "23:59", 59);
    const data = await call<{ items: Row[]; total: number; page: number; pages: number }>(
      "/api/audit",
      { query }
    );
    rows.value = data.items;
    total.value = data.total;
    pages.value = data.pages;
    page.value = data.page;
    // Sahifa raqami URL'da — yangilansa yoki ulashilsa o'sha sahifa ochiladi.
    router.replace({ query: { ...route.query, page: data.page, limit: limit.value } });
  } catch {
    error.value = "Jurnalni olib bo'lmadi.";
  } finally {
    loading.value = false;
  }
}

// Filtr o'zgarsa 1-sahifadan boshlaymiz.
const applyFilters = () => load(1);
watch(limit, () => load(1));

function go(p: number) {
  if (p < 1 || p > pages.value || p === page.value || loading.value) return;
  load(p);
  if (import.meta.client) window.scrollTo({ top: 0, behavior: "smooth" });
}

// Ko'rsatiladigan sahifa raqamlari: 1 … 4 5 [6] 7 8 … 20
const pageList = computed<(number | "…")[]>(() => {
  const n = pages.value, c = page.value;
  if (n <= 9) return Array.from({ length: n }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const a = Math.max(2, c - 2), b = Math.min(n - 1, c + 2);
  if (a > 2) out.push("…");
  for (let i = a; i <= b; i++) out.push(i);
  if (b < n - 1) out.push("…");
  out.push(n);
  return out;
});
const rangeText = computed(() => {
  if (!total.value) return "0 ta yozuv";
  const a = (page.value - 1) * limit.value + 1;
  const b = Math.min(total.value, page.value * limit.value);
  return `${a}–${b} / jami ${total.value}`;
});
const jumpTo = ref("");
function doJump() {
  const n = Number(jumpTo.value);
  if (Number.isInteger(n)) go(Math.min(Math.max(n, 1), pages.value));
  jumpTo.value = "";
}

// Mahalliy sana (ISO) + "SS:DD" -> serverdagi UTC formati "YYYY-MM-DD HH:MM:SS".
function toUtc(date: string, time: string, sec: number) {
  const [h, m] = (/^\d{1,2}:\d{2}$/.test(time.trim()) ? time.trim() : "00:00").split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  const dt = new Date(y, mo - 1, d, h, m, sec);
  return dt.toISOString().slice(0, 19).replace("T", " ");
}

// Server vaqti UTC (SQLite datetime('now')) -> mahalliy vaqtda ko'rsatamiz.
const fmt = (s: string) => fmtUtc(s);
// Tafsilotdagi ISO sanalar ("2026-11-07T08:59:33") ham KK.OO.YYYY ko'rinishida.
const isoToDmy = (v: string) => v.replace(/(\d{4})-(\d{2})-(\d{2})(?:T|\b)/g, (_, y, m, d) => `${d}.${m}.${y} `).trim();
const detailText = (d: any) =>
  d ? Object.entries(d).map(([k, v]) => `${k}: ${isoToDmy(typeof v === "object" ? JSON.stringify(v) : String(v))}`).join(", ") : "";

onMounted(() => load());
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h1>Audit jurnali</h1>
        <p class="sub">Kim, qachon, nima qildi: kirishlar, yozuvlarni ko'rish, boshqaruv amallari.</p>
      </div>
    </div>

    <form class="filters" @submit.prevent="applyFilters">
      <input v-model="f.user" class="input" placeholder="Login" />
      <select v-model="f.action" class="input">
        <option value="">Barcha amallar</option>
        <option value="login">Kirish</option>
        <option value="playback">Playback / eksport</option>
        <option value="camera">Kameralar</option>
        <option value="user">Foydalanuvchilar</option>
        <option value="role">Rollar</option>
        <option value="group">Guruhlar</option>
        <option value="nvr">NVR</option>
      </select>
      <span class="dt" title="Dan">
        <DateInput v-model="f.fromDate" :max="todayIso()" placeholder="dan: kk.oo.yyyy" />
        <input v-model="f.fromTime" class="input mono time" placeholder="00:00" maxlength="5" />
      </span>
      <span class="dt" title="Gacha">
        <DateInput v-model="f.toDate" :max="todayIso()" placeholder="gacha: kk.oo.yyyy" />
        <input v-model="f.toTime" class="input mono time" placeholder="23:59" maxlength="5" />
      </span>
      <button class="btn btn-primary" type="submit">Filtrlash</button>
    </form>

    <p v-if="error" class="err">{{ error }}</p>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Vaqt</th><th>Foydalanuvchi</th><th>Amal</th><th>Kamera</th><th>Tafsilot</th><th>IP</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td class="nowrap small">{{ fmt(r.created_at) }}</td>
            <td>{{ r.username || "—" }}</td>
            <td :class="{ bad: r.action === 'login.fail' }">{{ ACTIONS[r.action] || r.action }}</td>
            <td>{{ r.camera_name || "" }}</td>
            <td class="small muted">{{ detailText(r.details) }}</td>
            <td class="small muted mono">{{ r.ip }}</td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="6" class="muted">Yozuv yo'q</td></tr>
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span class="muted small">{{ rangeText }}</span>
      <div v-if="pages > 1" class="pages">
        <button class="btn btn-sm" :disabled="page === 1 || loading" @click="go(page - 1)">‹ Oldingi</button>
        <template v-for="(p, i) in pageList" :key="i">
          <span v-if="p === '…'" class="dots">…</span>
          <button
            v-else
            class="btn btn-sm num"
            :class="{ cur: p === page }"
            :disabled="loading"
            @click="go(p)"
          >
            {{ p }}
          </button>
        </template>
        <button class="btn btn-sm" :disabled="page === pages || loading" @click="go(page + 1)">Keyingi ›</button>
      </div>
      <div class="pager-right">
        <form v-if="pages > 9" class="jump" @submit.prevent="doJump">
          <input v-model="jumpTo" class="input input-xs" inputmode="numeric" placeholder="№" />
          <button class="btn btn-sm" type="submit">O'tish</button>
        </form>
        <select v-model.number="limit" class="input input-xs sel">
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
          <option :value="200">200</option>
        </select>
      </div>
    </div>
  </section>
</template>

<style scoped>
.dt {
  display: flex;
  gap: 4px;
}
.dt :deep(.date-input) {
  flex: 1;
}
.dt :deep(.date-input .input) {
  width: 100%;
}
.time {
  width: 70px;
}
.filters {
  display: grid;
  grid-template-columns: 1fr 1fr auto auto auto;
  gap: 8px;
  margin-bottom: 12px;
}
@media (max-width: 800px) {
  .filters {
    grid-template-columns: 1fr 1fr;
  }
}
.nowrap {
  white-space: nowrap;
}
.bad {
  color: var(--danger);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.pages {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}
.num {
  min-width: 34px;
  justify-content: center;
}
.num.cur {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
}
.dots {
  color: var(--muted);
  padding: 0 4px;
}
.pager-right {
  display: flex;
  gap: 8px;
  align-items: center;
}
.jump {
  display: flex;
  gap: 4px;
}
.input-xs {
  padding: 5px 8px;
  font-size: 15px;
  width: 64px;
}
.sel {
  width: 72px;
}
</style>
