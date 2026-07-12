<script setup lang="ts">
// Mehmon (guest) sahifa — cam.ttysi.uz ildizi, LOGIN TALAB QILINMAYDI.
// Kameralar to'liq ekranda 2×2 (4 bo'lak) ko'rsatiladi, pastda o'rtada
// pagination. Oqim "Ko'rish" bosilgandagina ochiladi — ungacha default
// kamera belgisi (placeholder) turadi, shunda kirgan zahoti 4 ta oqim
// birdan tortilib tarmoqni band qilmaydi.
const base = useRuntimeConfig().public.serviceBase as string;

const cameras = ref<Camera[]>([]);
const loading = ref(true);
const error = ref("");

const PER_PAGE = 4;
const page = ref(1);
const totalPages = computed(() =>
  Math.max(1, Math.ceil(cameras.value.length / PER_PAGE))
);
const visible = computed(() => {
  const start = (page.value - 1) * PER_PAGE;
  return cameras.value.slice(start, start + PER_PAGE);
});
// Grid doim 4 katakli (2×2) — kamera yetmasa bo'sh katak chiziladi.
const cells = computed<(Camera | null)[]>(() => {
  const arr: (Camera | null)[] = [...visible.value];
  while (arr.length < PER_PAGE) arr.push(null);
  return arr;
});

// "Ko'rish" bosilgan kameralar — faqat shulargagina pleyer ulanadi.
const started = ref(new Set<number>());

function play(c: Camera) {
  started.value = new Set(started.value).add(c.id);
}

function go(p: number) {
  if (p < 1 || p > totalPages.value || p === page.value) return;
  page.value = p;
  started.value = new Set(); // sahifa almashdi — oqimlar to'xtab placeholder qaytadi
}

// To'liq ekran: katak elementini fullscreen qilamiz; oqim hali ochilmagan
// bo'lsa avval uni yoqamiz (qora to'liq ekran chiqmasin).
const tiles = ref<(HTMLElement | null)[]>([]);
async function fullscreen(i: number, c: Camera | null) {
  if (!c) return;
  if (!started.value.has(c.id)) play(c);
  try {
    await tiles.value[i]?.requestFullscreen();
  } catch {
    /* eski brauzerlarda yo'q — jim o'tamiz */
  }
}

// Jonli soat (rasmdagidek HH:MM:SS)
const clock = ref("--:--:--");
let clockTimer: ReturnType<typeof setInterval> | null = null;
function tick() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  clock.value = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

onMounted(async () => {
  tick();
  clockTimer = setInterval(tick, 1000);
  try {
    const data = await $fetch<Camera[]>(`${base}/api/public/cameras`);
    if (!Array.isArray(data)) throw new Error("Kutilmagan javob");
    cameras.value = data;
  } catch {
    error.value = "Kameralar ro'yxatini olib bo'lmadi. Birozdan so'ng yangilang.";
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
});
</script>

<template>
  <div class="guest">
    <!-- Yuqori panel: brend + LIVE + soat (ixcham, kameralar ekranni egallasin) -->
    <header class="g-head">
      <div class="g-brand">
        <span class="g-logo">TTYSI</span>
        <div class="g-titles">
          <strong>Onlayn kuzatuv web sayti</strong>
          <span>Toshkent to'qimachilik va yengil sanoat instituti</span>
        </div>
      </div>
      <!-- Admin kirish havolasi ATAYIN yo'q — /login faqat URL'ni bilganlar uchun -->
      <div class="g-right">
        <span class="live"><span class="live-dot" />LIVE</span>
        <span class="clock">{{ clock }}</span>
      </div>
    </header>

    <!-- To'liq ekran 2×2 video devor -->
    <main class="g-main">
      <p v-if="loading" class="g-msg">Yuklanmoqda…</p>
      <p v-else-if="error" class="g-msg g-err">{{ error }}</p>
      <div v-else class="g-grid">
        <div
          v-for="(c, i) in cells"
          :key="c ? c.id : `empty-${i}`"
          :ref="(el) => (tiles[i] = el as HTMLElement | null)"
          class="tile"
        >
          <template v-if="c">
            <HlsPlayer v-if="started.has(c.id)" :src="c.hls" />

            <!-- Ko'rish bosilguncha — default belgi (placeholder) -->
            <div v-else class="ph">
              <svg class="ph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="7" width="13" height="10" rx="2" />
                <path d="m15 10 5-3v10l-5-3" />
              </svg>
              <button class="watch" @click="play(c)">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                Ko'rish
              </button>
            </div>

            <span class="tile-name">{{ c.name }}</span>
            <button class="fs" title="To'liq ekran" @click="fullscreen(i, c)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
              </svg>
            </button>
          </template>

          <div v-else class="ph ph-empty">
            <svg class="ph-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="7" width="13" height="10" rx="2" />
              <path d="m15 10 5-3v10l-5-3" />
            </svg>
          </div>
        </div>
      </div>
    </main>

    <!-- Pastda, o'rtada pagination -->
    <footer class="g-pager">
      <button class="pg" :disabled="page === 1" @click="go(page - 1)">‹</button>
      <button
        v-for="p in totalPages"
        :key="p"
        class="pg"
        :class="{ active: p === page }"
        @click="go(p)"
      >
        {{ p }}
      </button>
      <button class="pg" :disabled="page === totalPages" @click="go(page + 1)">›</button>
    </footer>
  </div>
</template>

<style scoped>
.guest {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: #0a0f18;
  color: #eaf1f8;
}

/* --- yuqori panel --- */
.g-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  background: linear-gradient(90deg, #16407f, #2b62b4);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  flex: none;
}
.g-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.g-logo {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #fff;
  color: #16407f;
  font-weight: 800;
  font-size: 10.5px;
  letter-spacing: 0.4px;
  border: 2px solid #cfe0f5;
}
.g-titles {
  display: grid;
  line-height: 1.25;
  min-width: 0;
}
.g-titles strong {
  font-size: 16px;
  font-weight: 700;
}
.g-titles span {
  font-size: 12px;
  color: #c9dbf3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.g-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.live {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: #22c55e;
  color: #06280f;
  font-weight: 700;
  font-size: 12.5px;
  letter-spacing: 0.6px;
  padding: 6px 14px;
  border-radius: 999px;
}
.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
.clock {
  background: rgba(10, 15, 24, 0.55);
  padding: 6px 14px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 13px;
}
/* --- video devor (2×2) --- */
.g-main {
  flex: 1;
  min-height: 0;
  display: flex;
}
.g-msg {
  margin: auto;
  color: #8fa3bd;
  font-size: 15px;
}
.g-err {
  color: #f87171;
}
.g-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 6px;
  padding: 6px;
  min-height: 0;
}
.tile {
  position: relative;
  min-height: 0;
  min-width: 0;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
}
/* HlsPlayer katakni to'liq egallasin (asl 16/9 o'rniga) */
.tile :deep(.player-box) {
  position: absolute;
  inset: 0;
  border-radius: 0;
}
.tile :deep(.player) {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  object-fit: contain;
}

/* placeholder — "Ko'rish" bosilgunga qadar */
.ph {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: radial-gradient(120% 120% at 50% 0%, #1d3c6e 0%, #12233f 45%, #0b1526 100%);
}
.ph-icon {
  width: 72px;
  height: 72px;
  color: rgba(201, 219, 243, 0.35);
}
.ph-empty .ph-icon {
  color: rgba(201, 219, 243, 0.12);
}
.watch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: #2b62b4;
  color: #fff;
  border: none;
  padding: 11px 26px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(15, 40, 80, 0.55);
  transition: background 0.15s ease, transform 0.15s ease;
}
.watch:hover {
  background: #3a76cf;
  transform: translateY(-1px);
}
.watch svg {
  width: 16px;
  height: 16px;
}

/* katak ustidagi yozuv/tugmalar */
.tile-name {
  position: absolute;
  left: 10px;
  top: 10px;
  background: rgba(8, 12, 20, 0.65);
  color: #eaf1f8;
  font-size: 12.5px;
  font-weight: 600;
  padding: 5px 11px;
  border-radius: 8px;
  backdrop-filter: blur(4px);
  max-width: 70%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
.fs {
  position: absolute;
  right: 10px;
  top: 10px;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: none;
  background: rgba(8, 12, 20, 0.65);
  color: #eaf1f8;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.15s ease;
}
.fs:hover {
  background: rgba(43, 98, 180, 0.85);
}
.fs svg {
  width: 18px;
  height: 18px;
}

/* --- pastdagi pagination (o'rtada) --- */
.g-pager {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.pg {
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
  color: #c9dbf3;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.pg:hover:not(:disabled):not(.active) {
  background: rgba(255, 255, 255, 0.12);
}
.pg.active {
  background: #2b62b4;
  border-color: #2b62b4;
  color: #fff;
}
.pg:disabled {
  opacity: 0.35;
  cursor: default;
}

/* --- mobil: bitta ustun, sahifa aylantiriladi --- */
@media (max-width: 760px) {
  .guest {
    height: auto;
    min-height: 100dvh;
  }
  .g-titles strong {
    font-size: 14px;
  }
  .clock {
    display: none;
  }
  .g-grid {
    grid-template-columns: 1fr;
    grid-template-rows: none;
    grid-auto-rows: auto;
  }
  .tile {
    aspect-ratio: 16 / 9;
  }
}
</style>
