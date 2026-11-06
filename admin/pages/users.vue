<script setup lang="ts">
definePageMeta({ permission: "users.manage" });

interface User {
  id: number;
  username: string;
  full_name: string | null;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
  role_ids: number[];
  group_ids: number[];
}
interface Role { id: number; name: string; description: string | null }
interface Group { id: number; name: string; camera_ids: number[] }

const { call } = useApi();
const { me } = useAuth();

const users = ref<User[]>([]);
const roles = ref<Role[]>([]);
const groups = ref<Group[]>([]);
const loading = ref(true);
const error = ref("");
const q = ref("");

// Forma: editing = null -> yopiq, 0 -> yangi, id -> tahrirlash
const editing = ref<number | null>(null);
const form = reactive({
  username: "",
  full_name: "",
  password: "",
  active: true,
  role_ids: [] as number[],
  group_ids: [] as number[],
});
const saving = ref(false);
const formError = ref("");

const roleName = (id: number) => roles.value.find((r) => r.id === id)?.name || `#${id}`;
const groupName = (id: number) => groups.value.find((g) => g.id === id)?.name || `#${id}`;

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (!s) return users.value;
  return users.value.filter(
    (u) => u.username.toLowerCase().includes(s) || (u.full_name || "").toLowerCase().includes(s)
  );
});

async function reload() {
  loading.value = true;
  error.value = "";
  try {
    [users.value, roles.value, groups.value] = await Promise.all([
      call<User[]>("/api/users"),
      call<Role[]>("/api/roles"),
      call<Group[]>("/api/groups"),
    ]);
  } catch {
    error.value = "Ma'lumotlarni olib bo'lmadi.";
  } finally {
    loading.value = false;
  }
}

function openNew() {
  editing.value = 0;
  Object.assign(form, {
    username: "",
    full_name: "",
    password: "",
    active: true,
    // Yangi xodim odatda dekanat roli bilan
    role_ids: roles.value.filter((r) => r.name === "dekanat").map((r) => r.id),
    group_ids: [],
  });
  formError.value = "";
}

function openEdit(u: User) {
  editing.value = u.id;
  Object.assign(form, {
    username: u.username,
    full_name: u.full_name || "",
    password: "",
    active: u.active,
    role_ids: [...u.role_ids],
    group_ids: [...u.group_ids],
  });
  formError.value = "";
}

async function save() {
  formError.value = "";
  const isNew = editing.value === 0;
  if (isNew && !/^[a-zA-Z0-9._-]{3,32}$/.test(form.username)) {
    return (formError.value = "Login 3-32 belgi: lotin harf, raqam, . _ -");
  }
  if ((isNew || form.password) && form.password.length < 8) {
    return (formError.value = "Parol kamida 8 belgi.");
  }
  saving.value = true;
  try {
    const body = {
      full_name: form.full_name || null,
      role_ids: form.role_ids,
      group_ids: form.group_ids,
      ...(form.password ? { password: form.password } : {}),
    };
    if (isNew) {
      await call("/api/users", { method: "POST", body: { ...body, username: form.username } });
    } else {
      await call(`/api/users/${editing.value}`, {
        method: "PUT",
        body: { ...body, active: form.active },
      });
    }
    editing.value = null;
    await reload();
  } catch (e: any) {
    formError.value = e?.data?.error || "Saqlab bo'lmadi.";
  } finally {
    saving.value = false;
  }
}

async function toggleActive(u: User) {
  try {
    await call(`/api/users/${u.id}`, { method: "PUT", body: { active: !u.active } });
    await reload();
  } catch (e: any) {
    alert(e?.data?.error || "Xatolik");
  }
}

async function remove(u: User) {
  if (!confirm(`"${u.username}" o'chirilsinmi? Buni qaytarib bo'lmaydi.`)) return;
  try {
    await call(`/api/users/${u.id}`, { method: "DELETE" });
    await reload();
  } catch (e: any) {
    alert(e?.data?.error || "Xatolik");
  }
}

function genPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(12);
  crypto.getRandomValues(buf);
  form.password = Array.from(buf, (n) => abc[n % abc.length]).join("");
}

const fmt = (s: string | null) => (s ? s.replace("T", " ").slice(0, 16) : "—");

onMounted(reload);
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h1>Foydalanuvchilar</h1>
        <p class="sub">Dekanat xodimlari va administratorlar. Kameralar guruh orqali biriktiriladi.</p>
      </div>
      <button v-if="editing === null" class="btn btn-primary" @click="openNew">+ Foydalanuvchi</button>
    </div>

    <form v-if="editing !== null" class="panel" @submit.prevent="save">
      <strong>{{ editing === 0 ? "Yangi foydalanuvchi" : `Tahrirlash: ${form.username}` }}</strong>
      <div class="row2">
        <div>
          <label class="label">Login</label>
          <input
            v-model="form.username"
            class="input"
            :disabled="editing !== 0"
            autocomplete="off"
            placeholder="masalan: iqtisod.dekan"
          />
        </div>
        <div>
          <label class="label">F.I.Sh</label>
          <input v-model="form.full_name" class="input" placeholder="Valiyev Ali" />
        </div>
      </div>
      <div>
        <label class="label">
          {{ editing === 0 ? "Parol (kamida 8 belgi)" : "Yangi parol (o'zgartirmaslik uchun bo'sh)" }}
        </label>
        <div class="pw">
          <input v-model="form.password" class="input mono" type="text" autocomplete="new-password" />
          <button class="btn" type="button" @click="genPassword">Generatsiya</button>
        </div>
        <p class="hint">Parolni foydalanuvchiga xavfsiz yo'l bilan bering; u Profil sahifasida o'zgartira oladi.</p>
      </div>

      <div>
        <label class="label">Rollar</label>
        <div class="checks">
          <label v-for="r in roles" :key="r.id" class="check">
            <input v-model="form.role_ids" type="checkbox" :value="r.id" />
            <span>{{ r.name }}<br /><small class="muted">{{ r.description }}</small></span>
          </label>
        </div>
      </div>

      <div>
        <label class="label">Kamera guruhlari (qaysi kameralarni ko'radi)</label>
        <div v-if="groups.length" class="checks">
          <label v-for="g in groups" :key="g.id" class="check">
            <input v-model="form.group_ids" type="checkbox" :value="g.id" />
            <span>{{ g.name }} <small class="muted">({{ g.camera_ids.length }} kamera)</small></span>
          </label>
        </div>
        <p v-else class="hint">
          Hali guruh yo'q — avval <NuxtLink to="/groups">Guruhlar</NuxtLink> sahifasida yarating.
        </p>
      </div>

      <label v-if="editing !== 0" class="check">
        <input v-model="form.active" type="checkbox" />
        <span>Faol (o'chirilsa tizimga kira olmaydi)</span>
      </label>

      <p v-if="formError" class="err">{{ formError }}</p>
      <div class="actions">
        <button class="btn" type="button" @click="editing = null">Bekor qilish</button>
        <button class="btn btn-primary" :disabled="saving" type="submit">
          {{ saving ? "Saqlanmoqda…" : "Saqlash" }}
        </button>
      </div>
    </form>

    <input v-model="q" class="input search" placeholder="Login yoki ism bo'yicha qidirish…" />

    <p v-if="loading" class="muted">Yuklanmoqda…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Foydalanuvchi</th>
            <th>Rollar</th>
            <th>Guruhlar</th>
            <th>Oxirgi kirish</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filtered" :key="u.id" :class="{ off: !u.active }">
            <td>
              <strong>{{ u.full_name || u.username }}</strong>
              <div class="muted mono small">{{ u.username }}</div>
              <span v-if="!u.active" class="badge badge-muted">bloklangan</span>
            </td>
            <td>
              <span v-for="r in u.role_ids" :key="r" class="badge badge-ok tag">{{ roleName(r) }}</span>
              <span v-if="!u.role_ids.length" class="muted">—</span>
            </td>
            <td>
              <span v-for="g in u.group_ids" :key="g" class="badge badge-muted tag">{{ groupName(g) }}</span>
              <span v-if="!u.group_ids.length" class="muted">—</span>
            </td>
            <td class="small muted">{{ fmt(u.last_login_at) }}</td>
            <td class="btns">
              <button class="btn btn-sm" @click="openEdit(u)">Tahrirlash</button>
              <button v-if="u.id !== me?.id" class="btn btn-sm" @click="toggleActive(u)">
                {{ u.active ? "Bloklash" : "Faollashtirish" }}
              </button>
              <button v-if="u.id !== me?.id" class="btn btn-sm btn-danger" @click="remove(u)">O'chirish</button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="5" class="muted">Topilmadi</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.search {
  max-width: 320px;
  margin-bottom: 12px;
}
.pw {
  display: flex;
  gap: 8px;
}
.mono {
  font-family: ui-monospace, monospace;
}
.small {
  font-size: 12px;
}
.tag {
  margin: 0 4px 4px 0;
}
.btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
tr.off td {
  opacity: 0.6;
}
</style>
