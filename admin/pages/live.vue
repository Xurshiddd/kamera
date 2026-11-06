<script setup lang="ts">
definePageMeta({ permission: "live.view" });

// Foydalanuvchiga ruxsat etilgan kameralarning jonli efiri. Bir vaqtda
// ko'p oqim ochilmasligi uchun sahifalab (2x2 / 3x3) ko'rsatiladi.
interface MyCamera {
  id: number;
  name: string;
  slug: string;
  is_public: boolean;
  playback: boolean;
  hls: string;
}

const { call } = useApi();
const { can } = useAuth();
const cameras = ref<MyCamera[]>([]);
const loading = ref(true);
const error = ref("");
const q = ref("");
const size = ref(4);
const page = ref(0);

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  return s ? cameras.value.filter((c) => c.name.toLowerCase().includes(s)) : cameras.value;
});
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / size.value)));
const visible = computed(() =>
  filtered.value.slice(page.value * size.value, (page.value + 1) * size.value)
);
watch([q, size], () => (page.value = 0));

onMounted(async () => {
  try {
    cameras.value = await call<MyCamera[]>("/api/me/cameras");
  } catch {
    error.value = "Kameralar ro'yxatini olib bo'lmadi.";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h1>Jonli efir</h1>
        <p v-if="!loading" class="sub">{{ cameras.length }} ta kamera sizga ochiq</p>
      </div>
      <div class="tools">
        <input v-model="q" class="input search" placeholder="Qidirish…" />
        <select v-model.number="size" class="input sel">
          <option :value="1">1</option>
          <option :value="4">2×2</option>
          <option :value="9">3×3</option>
        </select>
      </div>
    </div>

    <p v-if="loading" class="muted">Yuklanmoqda…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="!cameras.length" class="muted">
      Sizga hali kamera biriktirilmagan. Administratorga murojaat qiling.
    </p>

    <template v-else>
      <div class="grid" :class="`g${size}`">
        <article v-for="c in visible" :key="c.id" class="cell">
          <div class="cap">
            {{ c.name }}
            <NuxtLink
              v-if="c.playback && can('playback.view')"
              :to="{ path: '/playback', query: { camera: c.id } }"
              class="rec-link"
            >Yozuvlar →</NuxtLink>
          </div>
          <ClientOnly><HlsPlayer :src="c.hls" :camera-id="c.id" /></ClientOnly>
        </article>
      </div>
      <div v-if="pages > 1" class="pager">
        <button class="btn btn-sm" :disabled="page === 0" @click="page--">‹ Oldingi</button>
        <span class="muted">{{ page + 1 }} / {{ pages }}</span>
        <button class="btn btn-sm" :disabled="page >= pages - 1" @click="page++">Keyingi ›</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.tools {
  display: flex;
  gap: 8px;
}
.search {
  width: 200px;
}
.sel {
  width: 90px;
}
.grid {
  display: grid;
  gap: 12px;
}
.g4 {
  grid-template-columns: repeat(2, 1fr);
}
.g9 {
  grid-template-columns: repeat(3, 1fr);
}
@media (max-width: 720px) {
  .g4,
  .g9 {
    grid-template-columns: 1fr;
  }
}
.cell {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 8px;
}
.cap {
  font-size: 14px;
  font-weight: 600;
  margin: 2px 4px 8px;
}
.rec-link {
  float: right;
  font-size: 12px;
  font-weight: 400;
  color: var(--accent);
  text-decoration: none;
}
.pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 14px;
  margin-top: 16px;
}
</style>
