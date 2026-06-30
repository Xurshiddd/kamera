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
    hls = new Hls({ lowLatencyMode: true });
    hls.loadSource(props.src);
    hls.attachMedia(el);
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
