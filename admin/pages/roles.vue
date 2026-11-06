<script setup lang="ts">
definePageMeta({ permission: "roles.manage" });

interface Role {
  id: number;
  name: string;
  description: string | null;
  system: boolean;
  permissions: string[];
  users: number;
}
interface Perm { code: string; description: string }

const { call } = useApi();
const roles = ref<Role[]>([]);
const perms = ref<Perm[]>([]);
const loading = ref(true);
const error = ref("");

const editing = ref<number | null>(null); // 0 = yangi
const form = reactive({ name: "", description: "", permissions: [] as string[], system: false });
const saving = ref(false);
const formError = ref("");

// Ruxsatlarni prefiks bo'yicha guruhlab ko'rsatamiz (live, playback, users...).
const permGroups = computed(() => {
  const map = new Map<string, Perm[]>();
  for (const p of perms.value) {
    const k = p.code.split(".")[0];
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(p);
  }
  return [...map.entries()];
});
const permDesc = (c: string) => perms.value.find((p) => p.code === c)?.description || c;

async function reload() {
  loading.value = true;
  try {
    [roles.value, perms.value] = await Promise.all([
      call<Role[]>("/api/roles"),
      call<Perm[]>("/api/permissions"),
    ]);
  } catch {
    error.value = "Ma'lumotlarni olib bo'lmadi.";
  } finally {
    loading.value = false;
  }
}

function openNew() {
  editing.value = 0;
  Object.assign(form, { name: "", description: "", permissions: [], system: false });
  formError.value = "";
}
function openEdit(r: Role) {
  editing.value = r.id;
  Object.assign(form, {
    name: r.name,
    description: r.description || "",
    permissions: [...r.permissions],
    system: r.system,
  });
  formError.value = "";
}

async function save() {
  formError.value = "";
  if (!form.name.trim()) return (formError.value = "Rol nomi kerak.");
  saving.value = true;
  try {
    const body = { name: form.name, description: form.description || null, permissions: form.permissions };
    if (editing.value === 0) await call("/api/roles", { method: "POST", body });
    else await call(`/api/roles/${editing.value}`, { method: "PUT", body });
    editing.value = null;
    await reload();
  } catch (e: any) {
    formError.value = e?.data?.error || "Saqlab bo'lmadi.";
  } finally {
    saving.value = false;
  }
}

async function remove(r: Role) {
  if (!confirm(`"${r.name}" roli o'chirilsinmi? ${r.users} ta foydalanuvchidan olib tashlanadi.`)) return;
  try {
    await call(`/api/roles/${r.id}`, { method: "DELETE" });
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
        <h1>Rollar va ruxsatlar</h1>
        <p class="sub">Rol — ruxsatlar to'plami. Foydalanuvchiga bir yoki bir nechta rol beriladi.</p>
      </div>
      <button v-if="editing === null" class="btn btn-primary" @click="openNew">+ Rol</button>
    </div>

    <form v-if="editing !== null" class="panel" @submit.prevent="save">
      <strong>{{ editing === 0 ? "Yangi rol" : `Tahrirlash: ${form.name}` }}</strong>
      <div class="row2">
        <div>
          <label class="label">Nomi</label>
          <input v-model="form.name" class="input" :disabled="form.system" placeholder="masalan: kuzatuvchi" />
          <p v-if="form.system" class="hint">Tizim roli — nomini o'zgartirib bo'lmaydi.</p>
        </div>
        <div>
          <label class="label">Tavsif</label>
          <input v-model="form.description" class="input" />
        </div>
      </div>
      <div>
        <label class="label">Ruxsatlar</label>
        <div class="perm-groups">
          <fieldset v-for="[k, list] in permGroups" :key="k" class="pg">
            <legend class="mono">{{ k }}</legend>
            <label v-for="p in list" :key="p.code" class="check">
              <input v-model="form.permissions" type="checkbox" :value="p.code" />
              <span>{{ p.description }}<br /><small class="muted mono">{{ p.code }}</small></span>
            </label>
          </fieldset>
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
    <div v-else class="cards">
      <article v-for="r in roles" :key="r.id" class="panel card">
        <div class="card-head">
          <div>
            <strong>{{ r.name }}</strong>
            <span v-if="r.system" class="badge badge-muted" style="margin-left: 6px">tizim</span>
            <div class="muted small">{{ r.description }} · {{ r.users }} foydalanuvchi</div>
          </div>
          <div v-if="r.name !== 'superadmin'" class="btns">
            <button class="btn btn-sm" @click="openEdit(r)">Tahrirlash</button>
            <button v-if="!r.system" class="btn btn-sm btn-danger" @click="remove(r)">O'chirish</button>
          </div>
        </div>
        <div v-if="r.name === 'superadmin'" class="muted small">Barcha ruxsatlar (o'zgarmaydi)</div>
        <ul v-else class="plist">
          <li v-for="p in r.permissions" :key="p">{{ permDesc(p) }}</li>
          <li v-if="!r.permissions.length" class="muted">Ruxsat yo'q</li>
        </ul>
      </article>
    </div>
  </section>
</template>

<style scoped>
.mono {
  font-family: ui-monospace, monospace;
}
.small {
  font-size: 12px;
}
.perm-groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}
.pg {
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 8px 12px 12px;
  display: grid;
  gap: 8px;
  margin: 0;
}
.pg legend {
  color: var(--muted);
  font-size: 12px;
  padding: 0 4px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.card {
  margin: 0;
  align-content: start;
}
.card-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.btns {
  display: flex;
  gap: 6px;
  flex: none;
}
.plist {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  display: grid;
  gap: 3px;
}
</style>
