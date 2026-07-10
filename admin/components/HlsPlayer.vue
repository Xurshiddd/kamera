<script setup lang="ts">
import Hls from "hls.js";

const props = defineProps<{ src: string }>();
const video = ref<HTMLVideoElement | null>(null);
const waiting = ref(true); // oqim hali ochilmagan -> "ulanmoqda" qoplamasi
let hls: Hls | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let destroyed = false;

// Kamera o'chiq / ffmpeg endi ishga tushayotgan bo'lsa playlist hali yo'q (404).
// Bunday holatda HAR 5 SEKUNDDA qaytadan urinamiz — kamera tayyor bo'lishi
// bilan video o'zi ochiladi (sahifani yangilash shart emas).
function scheduleRetry() {
  waiting.value = true;
  if (retryTimer || destroyed) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    load();
  }, 5000);
}

function cleanup() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

function load() {
  const el = video.value;
  if (!el || !props.src || destroyed) return;
  cleanup();

  // Safari/iOS HLS'ni o'zi tushunadi; xato bo'lsa @error orqali qayta uriniladi.
  if (el.canPlayType("application/vnd.apple.mpegurl")) {
    el.src = props.src;
    el.play().catch(() => {});
    return;
  }
  if (!Hls.isSupported()) return;

  // MediaMTX'ning LL-HLS chiqishi hls.js'ning low-latency rejimida ishonchsiz,
  // shuning uchun oddiy (barqaror) HLS rejimi. Efirdan ~3 segment orqada turib
  // 20s gacha buferlaydi -> tarmoq tebranishini yutadi.
  hls = new Hls({
    lowLatencyMode: false,
    liveSyncDurationCount: 3,
    maxBufferLength: 20,
    backBufferLength: 10,
    fragLoadingMaxRetry: 6,
    manifestLoadingMaxRetry: 2, // uzoq kutmaymiz — baribir 5s'lik tsikl bor
    levelLoadingMaxRetry: 4,
  });
  hls.loadSource(props.src);
  hls.attachMedia(el);

  // Birinchi kadr yuklandi -> qoplamani olib tashlaymiz.
  hls.on(Hls.Events.FRAG_BUFFERED, () => (waiting.value = false));

  hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (!data.fatal || !hls) return;
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
      return;
    }
    // Tarmoq (playlist 404 / uzilish) yoki boshqa fatal xato -> to'liq qayta.
    scheduleRetry();
  });
}

// Safari (native) yo'lida video element xatosi -> 5s dan keyin qayta.
function onVideoError() {
  const el = video.value;
  if (el?.canPlayType("application/vnd.apple.mpegurl")) scheduleRetry();
}

function onPlaying() {
  waiting.value = false;
}

onMounted(load);
watch(
  () => props.src,
  () => {
    waiting.value = true;
    load();
  }
);
onBeforeUnmount(() => {
  destroyed = true;
  cleanup();
});
</script>

<template>
  <div class="player-box">
    <video
      ref="video"
      controls
      autoplay
      muted
      playsinline
      class="player"
      @error="onVideoError"
      @playing="onPlaying"
    />
    <div v-if="waiting" class="overlay">
      <span class="spinner" />
      <span>Oqim kutilmoqda…</span>
    </div>
  </div>
</template>

<style scoped>
.player-box {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  background: #000;
}
.player {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(8, 10, 14, 0.72);
  color: var(--muted);
  font-size: 13px;
  pointer-events: none;
}
.spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
