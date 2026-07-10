<script setup lang="ts">
// Server holati: uptime, CPU yuki, RAM, disk va har kameraning jonli holati.
// Har 5 sekundda avtomatik yangilanadi.
const { call } = useApi();

interface StreamRow {
  id: number;
  name: string;
  slug: string;
  codec: Codec;
  ready: boolean;
  readers: number;
  bytesReceived: number;
  since: string | null;
}
interface Status {
  server: {
    uptimeSec: number;
    loadavg: number[];
    cpus: number;
    memTotal: number;
    memFree: number;
  };
  serviceUptimeSec: number;
  mediamtxOk: boolean;
  disk: { total: number; used: number; free: number } | null;
  cameras: StreamRow[];
}

const status = ref<Status | null>(null);
const error = ref("");
let timer: ReturnType<typeof setInterval> | null = null;

async function refresh() {
  try {
    status.value = await call<Status>("/api/status");
    error.value = "";
  } catch {
    error.value = "Holatni olib bo'lmadi (service ulanmadi?).";
  }
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 5000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

// --- formatlash ---
function fmtBytes(n: number) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
function fmtDur(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} kun ${h} soat`;
  if (h) return `${h} soat ${m} daq`;
  return `${m} daqiqa`;
}
function sinceDur(iso: string | null) {
  if (!iso) return "—";
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  return sec > 0 ? fmtDur(sec) : "—";
}
const pct = (used: number, total: number) =>
  total ? Math.round((used / total) * 100) : 0;

const memUsed = computed(() =>
  status.value ? status.value.server.memTotal - status.value.server.memFree : 0
);
const cpuPct = computed(() => {
  if (!status.value) return 0;
  const { loadavg, cpus } = status.value.server;
  return Math.min(100, Math.round((loadavg[0] / cpus) * 100));
});
function barCls(p: number) {
  return p >= 90 ? "bar-danger" : p >= 70 ? "bar-warn" : "bar-ok";
}
const liveCount = computed(
  () => status.value?.cameras.filter((c) => c.ready).length ?? 0
);
</script>

<template>
  <section>
    <div class="head">
      <div>
        <h1>Server holati</h1>
        <p class="sub">Har 5 sekundda yangilanadi</p>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="!status" class="muted">Yuklanmoqda…</p>

    <template v-else>
      <div class="stats">
        <div class="stat">
          <div class="stat-label">Server ishlagan vaqti</div>
          <div class="stat-value">{{ fmtDur(status.server.uptimeSec) }}</div>
          <div class="stat-foot">service: {{ fmtDur(status.serviceUptimeSec) }}</div>
        </div>

        <div class="stat">
          <div class="stat-label">CPU yuki</div>
          <div class="stat-value">{{ cpuPct }}%</div>
          <div class="bar"><i :class="barCls(cpuPct)" :style="{ width: cpuPct + '%' }" /></div>
          <div class="stat-foot">
            load {{ status.server.loadavg[0].toFixed(2) }} / {{ status.server.cpus }} yadro
          </div>
        </div>

        <div class="stat">
          <div class="stat-label">Xotira (RAM)</div>
          <div class="stat-value">{{ pct(memUsed, status.server.memTotal) }}%</div>
          <div class="bar">
            <i :class="barCls(pct(memUsed, status.server.memTotal))"
               :style="{ width: pct(memUsed, status.server.memTotal) + '%' }" />
          </div>
          <div class="stat-foot">
            {{ fmtBytes(memUsed) }} / {{ fmtBytes(status.server.memTotal) }} —
            bo'sh {{ fmtBytes(status.server.memFree) }}
          </div>
        </div>

        <div v-if="status.disk" class="stat">
          <div class="stat-label">Disk</div>
          <div class="stat-value">{{ pct(status.disk.used, status.disk.total) }}%</div>
          <div class="bar">
            <i :class="barCls(pct(status.disk.used, status.disk.total))"
               :style="{ width: pct(status.disk.used, status.disk.total) + '%' }" />
          </div>
          <div class="stat-foot">
            {{ fmtBytes(status.disk.used) }} / {{ fmtBytes(status.disk.total) }} —
            bo'sh {{ fmtBytes(status.disk.free) }}
          </div>
        </div>
      </div>

      <p v-if="!status.mediamtxOk" class="err">
        MediaMTX'ga ulanib bo'lmadi — oqim ma'lumotlari ko'rinmaydi.
      </p>

      <div class="panel">
        <div class="panel-head">
          <h2>Oqimlar</h2>
          <span class="muted">{{ liveCount }} / {{ status.cameras.length }} jonli</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kamera</th>
                <th>Kodek</th>
                <th>Holat</th>
                <th>Jonli vaqti</th>
                <th>Tomoshabin</th>
                <th>Qabul qilingan</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in status.cameras" :key="c.id">
                <td>
                  <div class="cam-name">{{ c.name }}</div>
                  <div class="cam-slug mono">{{ c.slug }}</div>
                </td>
                <td>
                  <span v-if="c.codec === 'h264'" class="badge badge-ok" title="To'g'ridan-to'g'ri">H.264</span>
                  <span v-else-if="c.codec === 'hevc'" class="badge badge-warn" title="Transkod">H.265</span>
                  <span v-else class="badge badge-muted">?</span>
                </td>
                <td>
                  <span class="live" :class="c.ready ? 'live-on' : 'live-off'">
                    <i />{{ c.ready ? "Jonli" : "O'chiq" }}
                  </span>
                </td>
                <td>{{ c.ready ? sinceDur(c.since) : "—" }}</td>
                <td>{{ c.readers }}</td>
                <td>{{ fmtBytes(c.bytesReceived) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.head {
  margin-bottom: 18px;
}
h1 {
  margin: 0;
  font-size: 22px;
}
.sub {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
}
.muted {
  color: var(--muted);
}
.err {
  color: var(--danger);
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}
.stat {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px 16px;
}
.stat-label {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
}
.stat-value {
  font-size: 24px;
  font-weight: 650;
  letter-spacing: 0.3px;
}
.stat-foot {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}
.bar {
  margin-top: 8px;
  height: 6px;
  border-radius: 4px;
  background: var(--panel-2);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}
.bar-ok {
  background: var(--ok);
}
.bar-warn {
  background: #d29922;
}
.bar-danger {
  background: var(--danger);
}

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
.panel-head h2 {
  margin: 0;
  font-size: 16px;
}
.table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th,
td {
  text-align: left;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
th {
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
}
tr:last-child td {
  border-bottom: none;
}
.cam-name {
  font-weight: 550;
}
.cam-slug {
  font-size: 11px;
  color: var(--muted);
}
.mono {
  font-family: ui-monospace, monospace;
}
.live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.live i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.live-on {
  color: var(--ok);
}
.live-on i {
  background: var(--ok);
  box-shadow: 0 0 0 3px rgba(63, 185, 80, 0.15);
}
.live-off {
  color: var(--muted);
}
.live-off i {
  background: var(--muted);
}
</style>
