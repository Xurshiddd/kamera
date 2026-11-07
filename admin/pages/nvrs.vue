<script setup lang="ts">
definePageMeta({ permission: "nvr.manage" });

interface Nvr {
  id: number;
  name: string;
  ip: string;
  http_port: number;
  rtsp_port: number;
  login: string;
  cameras: number;
}
interface Channel {
  channel: number;
  name: string;
  ip: string | null;
  online: boolean | null;
  camera_id: number | null;
  camera_name: string | null;
}
interface Group { id: number; name: string }

const { call } = useApi();
const nvrs = ref<Nvr[]>([]);
const loading = ref(true);
const error = ref("");
const testMsg = ref<Record<number, { ok: boolean; text: string }>>({});

// --- NVR qo'shish/tahrirlash formasi ---
const editing = ref<number | null>(null); // 0 = yangi
const form = reactive({ name: "", ip: "", http_port: 80, rtsp_port: 554, login: "", parol: "" });
const saving = ref(false);
const formError = ref("");

async function reload() {
  loading.value = true;
  try {
    nvrs.value = await call<Nvr[]>("/api/nvrs");
  } catch {
    error.value = "NVR ro'yxatini olib bo'lmadi.";
  } finally {
    loading.value = false;
  }
}

function openNew() {
  editing.value = 0;
  Object.assign(form, { name: "", ip: "", http_port: 80, rtsp_port: 554, login: "", parol: "" });
  formError.value = "";
}
function openEdit(n: Nvr) {
  editing.value = n.id;
  Object.assign(form, { ...n, parol: "" });
  formError.value = "";
}

async function save() {
  formError.value = "";
  if (!form.name || !form.ip || !form.login || (editing.value === 0 && !form.parol)) {
    return (formError.value = "Nom, IP, login va parol majburiy.");
  }
  saving.value = true;
  try {
    if (editing.value === 0) await call("/api/nvrs", { method: "POST", body: form });
    else await call(`/api/nvrs/${editing.value}`, { method: "PUT", body: form });
    editing.value = null;
    await reload();
  } catch (e: any) {
    formError.value = e?.data?.error || "Saqlab bo'lmadi.";
  } finally {
    saving.value = false;
  }
}

async function test(n: Nvr) {
  testMsg.value = { ...testMsg.value, [n.id]: { ok: true, text: "Tekshirilmoqda…" } };
  try {
    const r = await call<{ info: any }>(`/api/nvrs/${n.id}/test`, { method: "POST" });
    testMsg.value = {
      ...testMsg.value,
      [n.id]: { ok: true, text: `✓ ${r.info.model} · ${r.info.firmware}` },
    };
  } catch (e: any) {
    testMsg.value = { ...testMsg.value, [n.id]: { ok: false, text: e?.data?.error || "Ulanmadi" } };
  }
}

async function remove(n: Nvr) {
  if (!confirm(`"${n.name}" NVR o'chirilsinmi?`)) return;
  try {
    await call(`/api/nvrs/${n.id}`, { method: "DELETE" });
    if (chNvr.value?.id === n.id) chNvr.value = null;
    await reload();
  } catch (e: any) {
    alert(e?.data?.error || "Xatolik");
  }
}

// --- Kanallar va import ---
const chNvr = ref<Nvr | null>(null);
const channels = ref<Channel[]>([]);
const chLoading = ref(false);
const chError = ref("");
const chQ = ref("");
const onlyOnline = ref(false);
const onlyNew = ref(true);
const selected = ref<number[]>([]);
const importPublic = ref(false);
const importGroup = ref<number | "">("");
const groups = ref<Group[]>([]);
const importing = ref(false);
const importMsg = ref("");

const visibleChannels = computed(() => {
  const s = chQ.value.trim().toLowerCase();
  return channels.value.filter(
    (c) =>
      (!onlyOnline.value || c.online) &&
      (!onlyNew.value || !c.camera_id) &&
      (!s || c.name.toLowerCase().includes(s) || String(c.channel) === s || (c.ip || "").includes(s))
  );
});
const stats = computed(() => ({
  total: channels.value.length,
  online: channels.value.filter((c) => c.online).length,
  imported: channels.value.filter((c) => c.camera_id).length,
}));

async function openChannels(n: Nvr) {
  chNvr.value = n;
  chLoading.value = true;
  chError.value = "";
  importMsg.value = "";
  selected.value = [];
  try {
    channels.value = await call<Channel[]>(`/api/nvrs/${n.id}/channels`);
  } catch (e: any) {
    chError.value = e?.data?.error || "Kanallarni olib bo'lmadi.";
    channels.value = [];
  } finally {
    chLoading.value = false;
  }
  if (!groups.value.length) {
    groups.value = await call<Group[]>("/api/groups").catch(() => []);
  }
}

function selectVisible(on: boolean) {
  const set = new Set(selected.value);
  for (const c of visibleChannels.value) {
    if (c.camera_id) continue;
    on ? set.add(c.channel) : set.delete(c.channel);
  }
  selected.value = [...set];
}

async function doImport() {
  if (!chNvr.value || !selected.value.length) return;
  importing.value = true;
  importMsg.value = "";
  try {
    const r = await call<{ created: number }>(`/api/nvrs/${chNvr.value.id}/import`, {
      method: "POST",
      body: {
        channels: selected.value,
        isPublic: importPublic.value,
        groupId: importGroup.value || null,
      },
    });
    importMsg.value = `${r.created} ta kamera qo'shildi.`;
    await Promise.all([openChannels(chNvr.value), reload()]);
    importMsg.value = `${r.created} ta kamera qo'shildi.`;
  } catch (e: any) {
    importMsg.value = e?.data?.error || "Import xatosi.";
  } finally {
    importing.value = false;
  }
}

onMounted(reload);
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h1>NVR qurilmalari</h1>
        <p class="sub">
          NVR kanallari kamera sifatida import qilinadi. Jonli efir faqat kimdir ko'rayotganda
          yoqiladi; yozuvlar NVR'ning o'zida saqlanadi.
        </p>
      </div>
      <button v-if="editing === null" class="btn btn-primary" @click="openNew">+ NVR</button>
    </div>

    <form v-if="editing !== null" class="panel" @submit.prevent="save">
      <strong>{{ editing === 0 ? "Yangi NVR" : `Tahrirlash: ${form.name}` }}</strong>
      <div class="row2">
        <div>
          <label class="label">Nomi</label>
          <input v-model="form.name" class="input" placeholder="masalan: Asosiy NVR" />
        </div>
        <div>
          <label class="label">IP manzil</label>
          <input v-model="form.ip" class="input mono" placeholder="192.168.18.2" />
        </div>
      </div>
      <div class="row2">
        <div>
          <label class="label">HTTP port (ISAPI)</label>
          <input v-model.number="form.http_port" class="input" type="number" />
        </div>
        <div>
          <label class="label">RTSP port</label>
          <input v-model.number="form.rtsp_port" class="input" type="number" />
        </div>
      </div>
      <div class="row2">
        <div>
          <label class="label">Login</label>
          <input v-model="form.login" class="input" autocomplete="off" />
        </div>
        <div>
          <label class="label">Parol</label>
          <input
            v-model="form.parol"
            class="input"
            type="password"
            autocomplete="new-password"
            :placeholder="editing ? 'O\'zgartirmaslik uchun bo\'sh qoldiring' : ''"
          />
        </div>
      </div>
      <p class="hint">
        Saqlashdan oldin NVR'ga ulanib tekshiriladi. Tavsiya: NVR'da faqat Live/Playback
        ruxsatli alohida Operator foydalanuvchi oching.
      </p>
      <p v-if="formError" class="err">{{ formError }}</p>
      <div class="actions">
        <button class="btn" type="button" @click="editing = null">Bekor qilish</button>
        <button class="btn btn-primary" :disabled="saving" type="submit">
          {{ saving ? "Ulanmoqda…" : "Saqlash" }}
        </button>
      </div>
    </form>

    <p v-if="loading" class="muted">Yuklanmoqda…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="!nvrs.length && editing === null" class="muted">
      Hali NVR qo'shilmagan. "+ NVR" tugmasini bosing.
    </p>

    <div class="nvr-list">
      <article v-for="n in nvrs" :key="n.id" class="panel nvr" :class="{ active: chNvr?.id === n.id }">
        <div class="nvr-head">
          <div>
            <strong>{{ n.name }}</strong>
            <div class="muted small mono">{{ n.login }}@{{ n.ip }}:{{ n.http_port }} · RTSP {{ n.rtsp_port }}</div>
            <div class="small">{{ n.cameras }} ta kamera import qilingan</div>
          </div>
          <div class="btns">
            <button class="btn btn-sm btn-primary" @click="openChannels(n)">Kanallar</button>
            <button class="btn btn-sm" @click="test(n)">Tekshirish</button>
            <button class="btn btn-sm" @click="openEdit(n)">Tahrirlash</button>
            <button class="btn btn-sm btn-danger" @click="remove(n)">O'chirish</button>
          </div>
        </div>
        <p v-if="testMsg[n.id]" :class="testMsg[n.id].ok ? 'ok-text' : 'err'" class="small">
          {{ testMsg[n.id].text }}
        </p>
      </article>
    </div>

    <section v-if="chNvr" class="panel">
      <div class="nvr-head">
        <div>
          <strong>{{ chNvr.name }} — kanallar</strong>
          <div v-if="!chLoading && !chError" class="muted small">
            Jami {{ stats.total }} · onlayn {{ stats.online }} · import qilingan {{ stats.imported }}
          </div>
        </div>
        <button class="btn btn-sm" @click="chNvr = null">Yopish</button>
      </div>

      <p v-if="chLoading" class="muted">NVR'dan o'qilmoqda…</p>
      <p v-else-if="chError" class="err">{{ chError }}</p>
      <template v-else>
        <div class="filters">
          <input v-model="chQ" class="input" placeholder="Nom, kanal yoki IP…" />
          <label class="check"><input v-model="onlyOnline" type="checkbox" /> Faqat onlayn</label>
          <label class="check"><input v-model="onlyNew" type="checkbox" /> Faqat qo'shilmaganlar</label>
          <button class="btn btn-sm" @click="selectVisible(true)">Ko'ringanlarni tanlash</button>
          <button class="btn btn-sm" @click="selectVisible(false)">Tanlovni olish</button>
        </div>

        <div class="table-wrap ch-table">
          <table class="table">
            <thead>
              <tr><th></th><th>Kanal</th><th>Nomi (NVR'da)</th><th>Kamera IP</th><th>Holat</th><th>Tizimda</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in visibleChannels" :key="c.channel">
                <td>
                  <input
                    v-model="selected"
                    type="checkbox"
                    :value="c.channel"
                    :disabled="!!c.camera_id"
                  />
                </td>
                <td class="mono">{{ c.channel }}</td>
                <td>{{ c.name || "—" }}</td>
                <td class="mono small muted">{{ c.ip }}</td>
                <td>
                  <span v-if="c.online" class="badge badge-ok">onlayn</span>
                  <span v-else class="badge badge-muted">oflayn</span>
                </td>
                <td class="small">{{ c.camera_name ? "✓ " + c.camera_name : "" }}</td>
              </tr>
              <tr v-if="!visibleChannels.length"><td colspan="6" class="muted">Kanal yo'q</td></tr>
            </tbody>
          </table>
        </div>

        <div class="import-bar">
          <span><strong>{{ selected.length }}</strong> ta tanlandi</span>
          <label class="check"><input v-model="importPublic" type="checkbox" /> Mehmon sahifasida ochiq</label>
          <select v-model="importGroup" class="input sel">
            <option value="">Guruhsiz</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">Guruhga: {{ g.name }}</option>
          </select>
          <button class="btn btn-primary" :disabled="!selected.length || importing" @click="doImport">
            {{ importing ? "Qo'shilmoqda…" : "Kamera sifatida qo'shish" }}
          </button>
        </div>
        <p v-if="importMsg" class="ok-text">{{ importMsg }}</p>
      </template>
    </section>
  </section>
</template>

<style scoped>
.nvr-list {
  display: grid;
  gap: 12px;
  margin-bottom: 18px;
}
.nvr {
  margin: 0;
  gap: 8px;
}
.nvr.active {
  border-color: var(--accent);
}
.nvr-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}
.btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.filters {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.filters .input {
  width: 220px;
}
.ch-table {
  max-height: 460px;
  overflow: auto;
}
.import-bar {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.sel {
  width: auto;
}
</style>
