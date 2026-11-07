<script setup lang="ts">
import Hls from "hls.js";

// cameraId berilsa — ko'rish davomida har 20s da service'ga heartbeat
// yuboriladi. NVR kameralari shu orqali so'rov bo'yicha yoqiladi va hech kim
// ko'rmay qo'ygach ~1 daqiqada o'chadi.
// vod=true — yozuv (playback) rejimi: boshidan o'ynaydi, jonli chetga sakramaydi
// va joriy vaqtni "time" hodisasi bilan bildiradi.
const props = defineProps<{ src: string; cameraId?: number; vod?: boolean }>();
const emit = defineEmits<{ (e: "time", seconds: number): void; (e: "playing", on: boolean): void }>();
const watchError = ref("");
const { token } = useAuth(); // setup paytida olinadi (callback'larda ham ishlatiladi)
let beatTimer: ReturnType<typeof setInterval> | null = null;

async function heartbeat() {
  if (!props.cameraId || destroyed) return;
  const base = useRuntimeConfig().public.serviceBase as string;
  try {
    await $fetch(`${base}/api/live/${props.cameraId}/watch`, {
      method: "POST",
      headers: token.value ? { Authorization: `Bearer ${token.value}` } : {},
    });
    watchError.value = "";
  } catch (e: any) {
    watchError.value = e?.data?.error || "";
  }
}

function startBeat() {
  stopBeat();
  if (!props.cameraId) return;
  heartbeat();
  beatTimer = setInterval(heartbeat, 20000);
}
function stopBeat() {
  if (beatTimer) clearInterval(beatTimer);
  beatTimer = null;
}
const video = ref<HTMLVideoElement | null>(null);
const waiting = ref(true); // oqim hali ochilmagan -> "ulanmoqda" qoplamasi
// Ota sahifa "JONLI" belgisini faqat tasvir kelayotganda ko'rsatishi uchun.
watch(waiting, (w) => emit("playing", !w));
let hls: Hls | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let destroyed = false;
let attempts = 0; // ketma-ket muvaffaqiyatsiz urinishlar

// Kamera o'chiq / ffmpeg endi ishga tushayotgan bo'lsa playlist hali yo'q (404).
// Bunday holatda HAR 5 SEKUNDDA qaytadan urinamiz — kamera tayyor bo'lishi
// bilan video o'zi ochiladi (sahifani yangilash shart emas).
// NVR kamerasi so'rov bo'yicha ~3s da yoqiladi — shuning uchun dastlabki
// urinishlar tez (1.5s), keyin har 5s.
function scheduleRetry() {
  waiting.value = true;
  if (retryTimer || destroyed) return;
  attempts++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    load();
  }, attempts <= 6 ? 1500 : 5000);
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

  // hls.js — imkon bo'lsa DOIM (yangi Chrome ham HLS'ni o'zi o'ynaydi, lekin
  // o'shanda yopiq kameralar uchun token sarlavhasini yuborib bo'lmaydi).
  // Brauzerning o'z pleyeri faqat zaxira (eski iOS Safari) — u faqat ochiq
  // kameralarni ko'rsata oladi; xato bo'lsa @error orqali qayta uriniladi.
  if (!Hls.isSupported()) {
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = props.src;
      el.play().catch(() => {});
    }
    return;
  }

  // MediaMTX'ning LL-HLS chiqishi hls.js'ning low-latency rejimida ishonchsiz,
  // shuning uchun oddiy (barqaror) HLS rejimi. Efirdan ~3 segment orqada turib
  // 20s gacha buferlaydi -> tarmoq tebranishini yutadi.
  hls = new Hls({
    lowLatencyMode: false,
    ...(props.vod
      ? { startPosition: 0, liveSyncDurationCount: 1e6, liveMaxLatencyDurationCount: Infinity }
      : { liveSyncDurationCount: 3 }),
    maxBufferLength: 20,
    backBufferLength: 10,
    fragLoadingMaxRetry: 6,
    manifestLoadingMaxRetry: 2, // uzoq kutmaymiz — baribir 5s'lik tsikl bor
    levelLoadingMaxRetry: 4,
    // Yopiq kameralar oqimi token bilan beriladi (gateway auth_request).
    // Token faqat shu saytning o'z manziliga yuboriladi — begona domenga emas.
    xhrSetup: (xhr: XMLHttpRequest, url: string) => {
      if (token.value && new URL(url, location.href).origin === location.origin) {
        xhr.setRequestHeader("Authorization", `Bearer ${token.value}`);
      }
    },
  });
  hls.loadSource(props.src);
  hls.attachMedia(el);

  // Birinchi kadr yuklandi -> qoplamani olib tashlaymiz.
  hls.on(Hls.Events.FRAG_BUFFERED, () => {
    waiting.value = false;
    attempts = 0;
  });

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
  attempts = 0;
}

onMounted(() => {
  startBeat();
  load();
});
watch(
  () => [props.src, props.cameraId],
  () => {
    waiting.value = true;
    startBeat();
    load();
  }
);
onBeforeUnmount(() => {
  destroyed = true;
  stopBeat();
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
      @timeupdate="emit('time', ($event.target as HTMLVideoElement).currentTime)"
    />
    <div v-if="waiting" class="overlay">
      <span class="spinner" />
      <span>{{ watchError || "Oqim kutilmoqda…" }}</span>
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
  font-size: 15px;
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
