<script setup lang="ts">
import Hls from "hls.js";

const props = defineProps<{ src: string }>();
const video = ref<HTMLVideoElement | null>(null);
let hls: Hls | null = null;

function load() {
  const el = video.value;
  if (!el || !props.src) return;

  if (hls) {
    hls.destroy();
    hls = null;
  }

  // Safari/iOS HLS'ni o'zi tushunadi
  if (el.canPlayType("application/vnd.apple.mpegurl")) {
    el.src = props.src;
    return;
  }
  if (Hls.isSupported()) {
    // MediaMTX'ning LL-HLS chiqishi hls.js'ning low-latency rejimida ishonchsiz:
    // efir ochilmay osilib qoladi. Kamera kuzatuvida past kechikish shart emas,
    // shuning uchun oddiy (barqaror) HLS rejimini ishlatamiz.
    hls = new Hls({ lowLatencyMode: false });
    hls.loadSource(props.src);
    hls.attachMedia(el);

    // Sovuq start (MediaMTX ffmpeg'ni ishga tushirayotgan ~15s) yoki vaqtinchalik
    // uzilishda hls.js fatal xato berib to'xtab qolmasin — qaytadan urinamiz.
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal || !hls) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad(); // playlist/segment qayta yuklashga urinamiz
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        hls.destroy();
        hls = null;
      }
    });
  }
}

onMounted(load);
watch(() => props.src, load);
onBeforeUnmount(() => hls?.destroy());
</script>

<template>
  <video ref="video" controls autoplay muted playsinline class="player" />
</template>

<style scoped>
.player {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 10px;
}
</style>
