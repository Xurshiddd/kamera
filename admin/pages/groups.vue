<script setup lang="ts">
definePageMeta({ permission: "groups.manage" });

// Kamera guruhlari (masalan fakultet). Foydalanuvchiga guruh biriktiriladi —
// u faqat shu guruhdagi kameralarni ko'radi ("cameras.all" ruxsati bo'lmasa).
interface Group { id: number; name: string; camera_ids: number[]; users: number }
interface Cam { id: number; name: string }

const { call } = useApi();
const groups = ref<Group[]>([]);
const cameras = ref<Cam[]>([]);
const loading = ref(true);
const error = ref("");

const editing = ref<number | null>(null);
const form = reactive({ name: "", camera_ids: [] as number[] });
const camQ = ref("");
const saving = ref(false);
const formError = ref("");

const camName = (id: number) => cameras.value.find((c) => c.id === id)?.name || `#${id}`;
const camList = computed(() => {
  const s = camQ.value.trim().toLowerCase();
  return s ? cameras.value.filter((c) => c.name.toLowerCase().includes(s)) : cameras.value;
});

async function reload() {
  loading.value = true;
  try {
    [groups.value, cameras.value] = await Promise.all([
      call<Group[]>("/api/groups"),
      call<Cam[]>("/api/me/cameras"),
    ]);
  } catch {
    error.value = "Ma'lumotlarni olib bo'lmadi.";
  } finally {
    loading.value = false;
  }
}

function openNew() {
  editing.value = 0;
  Object.assign(form, { name: "", camera_ids: [] });
  camQ.value = "";
  formError.value = "";
}
function openEdit(g: Group) {
  editing.value = g.id;
  Object.assign(form, { name: g.name, camera_ids: [...g.camera_ids] });
  camQ.value = "";
  formError.value = "";
}
function selectAll(on: boolean) {
  const ids = new Set(form.camera_ids);
  for (const c of camList.value) on ? ids.add(c.id) : ids.delete(c.id);
  form.camera_ids = [...ids];
}

async function save() {
  formError.value = "";
  if (!form.name.trim()) return (formError.value = "Guruh nomi kerak.");
  saving.value = true;
  try {
    const body = { name: form.name, camera_ids: form.camera_ids };
    if (editing.value === 0) await call("/api/groups", { method: "POST", body });
    else await call(`/api/groups/${editing.value}`, { method: "PUT", body });
    editing.value = null;
    await reload();
  } catch (e: any) {
    formError.value = e?.data?.error || "Saqlab bo'lmadi.";
  } finally {
    saving.value = false;
  }
}

async function remove(g: Group) {
  if (!confirm(`"${g.name}" guruhi o'chirilsinmi? ${g.users} ta foydalanuvchi bu kameralarni ko'rmay qoladi.`)) return;
  try {
    await call(`/api/groups/${g.id}`, { method: "DELETE" });
    await reload();
  } catch (e: any) {
    alert(e?.data?.error || "Xatolik");
  }
}

onMounted(reload);
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h1>Kamera guruhlari</h1>
        <p class="sub">Masalan, har bir fakultet uchun bitta guruh. Xodimga guruh beriladi.</p>
      </div>
      <button v-if="editing === null" class="btn btn-primary" @click="openNew">+ Guruh</button>
    </div>

    <form v-if="editing !== null" class="panel" @submit.prevent="save">
      <strong>{{ editing === 0 ? "Yangi guruh" : `Tahrirlash: ${form.name}` }}</strong>
      <div>
        <label class="label">Nomi</label>
        <input v-model="form.name" class="input" placeholder="masalan: Iqtisod fakulteti" />
      </div>
      <div>
        <div class="cam-head">
          <label class="label">Kameralar ({{ form.camera_ids.length }} tanlangan)</label>
          <div class="btns">
            <input v-model="camQ" class="input input-sm" placeholder="Qidirish…" />
            <button class="btn btn-sm" type="button" @click="selectAll(true)">Hammasi</button>
            <button class="btn btn-sm" type="button" @click="selectAll(false)">Hech biri</button>
          </div>
        </div>
        <div class="checks">
          <label v-for="c in camList" :key="c.id" class="check">
            <input v-model="form.camera_ids" type="checkbox" :value="c.id" />
            <span>{{ c.name }}</span>
          </label>
          <span v-if="!camList.length" class="muted">Kamera topilmadi</span>
        </div>
      </div>
      <p v-if="formError" class="err">{{ formError }}</p>
      <div class="actions">
        <button class="btn" type="button" @click="editing = null">Bekor qilish</button>
        <button class="btn btn-primary" :disabled="saving" type="submit">
          {{ saving ? "Saqlanmoqda…" : "Saqlash" }}
        </button>
      </div>
    </form>

    <p v-if="loading" class="muted">Yuklanmoqda…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="!groups.length" class="muted">Hali guruh yo'q.</p>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Guruh</th><th>Kameralar</th><th>Foydalanuvchi</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="g in groups" :key="g.id">
            <td><strong>{{ g.name }}</strong></td>
            <td>
              <span v-for="id in g.camera_ids.slice(0, 8)" :key="id" class="badge badge-muted tag">
                {{ camName(id) }}
              </span>
              <span v-if="g.camera_ids.length > 8" class="muted small">+{{ g.camera_ids.length - 8 }}</span>
              <span v-if="!g.camera_ids.length" class="muted">—</span>
            </td>
            <td>{{ g.users }}</td>
            <td class="btns end">
              <button class="btn btn-sm" @click="openEdit(g)">Tahrirlash</button>
              <button class="btn btn-sm btn-danger" @click="remove(g)">O'chirish</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.cam-head {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.btns {
  display: flex;
  gap: 6px;
  align-items: center;
}
.end {
  justify-content: flex-end;
}
.input-sm {
  padding: 6px 10px;
  width: 160px;
}
.tag {
  margin: 0 4px 4px 0;
}
.small {
  font-size: 12px;
}
</style>
