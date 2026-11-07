<script setup lang="ts">
definePageMeta({ permission: "live.view" });

// Foydalanuvchiga ruxsat etilgan kameralarning jonli efiri. Bir vaqtda
// ko'p oqim ochilmasligi uchun sahifalab ko'rsatiladi (4 / 6 / 9 ta).
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
const route = useRoute();
const router = useRouter();

const cameras = ref<MyCamera[]>([]);
const loading = ref(true);
const error = ref("");
const q = ref("");
const building = ref<string>((route.query.bino as string) || "");
const size = ref<number>([4, 6, 9].includes(Number(route.query.n)) ? Number(route.query.n) : 6);
const page = ref(0);
const big = ref<MyCamera | null>(null);
// Tasviri kelayotgan kameralar (faqat ularda "JONLI" belgisi).
const playing = reactive(new Set<number>());
const setPlaying = (id: number, on: boolean) => (on ? playing.add(id) : playing.delete(id));

// Bino nomdan olinadi: "2.208" -> "2-bino". Raqam bilan boshlanmasa — "Boshqa".
const buildingOf = (name: string) => {
  const m = name.trim().match(/^(\d+)\./);
  return m ? `${m[1]}-bino` : "Boshqa";
};
const buildings = computed(() => {
  const set = new Set(cameras.value.map((c) => buildingOf(c.name)));
  return [...set].sort((a, b) => (a === "Boshqa" ? 1 : b === "Boshqa" ? -1 : parseInt(a) - parseInt(b)));
});

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  return cameras.value.filter(
    (c) => (!building.value || buildingOf(c.name) === building.value) && (!s || c.name.toLowerCase().includes(s))
  );
});
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / size.value)));
const visible = computed(() => filtered.value.slice(page.value * size.value, (page.value + 1) * size.value));
watch([q, size, building], () => {
  page.value = 0;
  router.replace({ query: { ...(building.value ? { bino: building.value } : {}), n: size.value } });
});

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") big.value = null;
}
onMounted(async () => {
  window.addEventListener("keydown", onKey);
  try {
    cameras.value = await call<MyCamera[]>("/api/me/cameras");
  } catch {
    error.value = "Kameralar roʻyxatini olib boʻlmadi.";
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h1>Jonli kuzatuv</h1>
        <p class="sub">Xonani bosing — tasvir butun ekranga ochiladi.</p>
      </div>
      <div class="search">
        <label class="label" for="q">Xona qidirish</label>
        <input id="q" v-model="q" type="search" class="input" placeholder="masalan: 2.208" />
      </div>
    </div>

    <p v-if="loading" class="muted big-msg">Yuklanmoqda…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="!cameras.length" class="muted big-msg">
      Sizga hali kamera biriktirilmagan. Administratorga murojaat qiling.
    </p>

    <template v-else>
      <div class="filters panel">
        <span class="flabel">Bino:</span>
        <div class="chips" role="group" aria-label="Bino boʻyicha">
          <button class="btn" :class="{ 'btn-primary': !building }" :aria-pressed="!building" @click="building = ''">
            Hammasi
          </button>
          <button
            v-for="b in buildings"
            :key="b"
            class="btn"
            :class="{ 'btn-primary': building === b }"
            :aria-pressed="building === b"
            @click="building = b"
          >
            {{ b }}
          </button>
        </div>
        <span class="spacer" />
        <span class="flabel">Ekranda:</span>
        <div class="chips" role="group" aria-label="Bir ekrandagi kameralar soni">
          <button
            v-for="n in [4, 6, 9]"
            :key="n"
            class="btn"
            :class="{ 'btn-primary': size === n }"
            :aria-pressed="size === n"
            @click="size = n"
          >
            {{ n }} ta
          </button>
        </div>
      </div>

      <p v-if="!filtered.length" class="muted big-msg">Bunday xona topilmadi.</p>

      <div class="grid" :class="`g${size}`">
        <article v-for="c in visible" :key="c.id" class="cell">
          <button class="video" :aria-label="`${c.name} — kattalashtirish`" @click="big = c">
            <ClientOnly><HlsPlayer :src="c.hls" :camera-id="c.id" @playing="setPlaying(c.id, $event)" /></ClientOnly>
            <span v-if="playing.has(c.id)" class="live-tag"><span class="pulse" />JONLI</span>
          </button>
          <div class="cap">
            <div class="cap-text">
              <span class="name">{{ c.name }}</span>
              <span class="place">{{ buildingOf(c.name) }}</span>
            </div>
            <NuxtLink
              v-if="c.playback && can('playback.view')"
              :to="{ path: '/playback', query: { camera: c.id } }"
              class="btn btn-soft"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></svg>
              Yozuvlar
            </NuxtLink>
          </div>
        </article>
      </div>

      <Pager :model-value="page + 1" :pages="pages" @update:model-value="page = $event - 1" />
    </template>

    <!-- Kattalashtirilgan ko'rinish -->
    <div v-if="big" class="overlay" role="dialog" aria-modal="true" :aria-label="big.name" @click.self="big = null">
      <div class="big-box">
        <div class="big-head">
          <span class="big-name">{{ big.name }}</span>
          <span class="live-tag static"><span class="pulse" />JONLI</span>
          <span class="spacer" />
          <NuxtLink
            v-if="big.playback && can('playback.view')"
            :to="{ path: '/playback', query: { camera: big.id } }"
            class="btn btn-soft"
          >Yozuvlar</NuxtLink>
          <button class="btn btn-primary" @click="big = null">✕ Yopish</button>
        </div>
        <ClientOnly><HlsPlayer :key="`big-${big.id}`" :src="big.hls" :camera-id="big.id" /></ClientOnly>
      </div>
    </div>
  </section>
</template>

<style scoped>
.search {
  width: 300px;
  max-width: 100%;
}
.big-msg {
  font-size: 20px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
}
.flabel {
  font-size: 19px;
  font-weight: 600;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.spacer {
  flex: 1;
}
.grid {
  display: grid;
  gap: 22px;
}
.g4 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.g6,
.g9 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
@media (max-width: 1000px) {
  .g6,
  .g9 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 700px) {
  .g4,
  .g6,
  .g9 {
    grid-template-columns: 1fr;
  }
  .search {
    width: 100%;
  }
}
.cell {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.video {
  position: relative;
  display: block;
  padding: 0;
  border: 0;
  background: #1f2937;
  cursor: zoom-in;
  text-align: left;
}
.video :deep(video) {
  pointer-events: none;
}
.live-tag {
  position: absolute;
  top: 12px;
  left: 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
  background: var(--danger);
  border-radius: 8px;
  z-index: 2;
}
.live-tag.static {
  position: static;
}
.pulse {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ffffff;
}
.cap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
}
.cap-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-size: 23px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.place {
  font-size: 16px;
  color: var(--muted);
}
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(17, 24, 39, 0.85);
  display: grid;
  place-items: center;
  padding: 20px;
}
.big-box {
  width: min(1400px, 100%);
  background: var(--panel);
  border-radius: 16px;
  padding: 16px;
  display: grid;
  gap: 12px;
}
.big-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.big-name {
  font-size: 28px;
  font-weight: 700;
}
</style>
