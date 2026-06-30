<script setup lang="ts">
const { list, remove } = useCameras();

const cameras = ref<Camera[]>([]);
const loading = ref(true);
const error = ref("");
const preview = ref<string | null>(null); // qaysi slug ko'rsatilmoqda

async function reload() {
  loading.value = true;
  error.value = "";
  try {
    cameras.value = await list();
  } catch (e: any) {
    error.value = "Service'ga ulanib bo'lmadi. Server manzili/kalitni tekshiring.";
  } finally {
    loading.value = false;
  }
}

async function onDelete(c: Camera) {
  if (!confirm(`"${c.name}" o'chirilsinmi?`)) return;
  await remove(c.id);
  await reload();
}

function copy(text: string) {
  navigator.clipboard?.writeText(text);
}

onMounted(reload);
</script>

<template>
  <section>
    <div class="head">
      <h1>Kameralar</h1>
      <NuxtLink to="/add" class="btn btn-primary">+ Kamera qo'shish</NuxtLink>
    </div>

    <p v-if="loading" class="muted">Yuklanmoqda…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="!cameras.length" class="muted">
      Hali kamera yo'q. Yuqoridagi tugma orqali birinchisini qo'shing.
    </p>

    <div v-else class="grid">
      <article v-for="c in cameras" :key="c.id" class="card">
        <div class="card-head">
          <div>
            <h3>{{ c.name }}</h3>
            <span class="slug">{{ c.slug }}</span>
          </div>
          <button class="btn btn-danger" @click="onDelete(c)">O'chirish</button>
        </div>

        <ClientOnly>
          <HlsPlayer v-if="preview === c.slug" :src="c.hls" />
          <button v-else class="preview-stub" @click="preview = c.slug">
            ▶ Jonli ko'rish
          </button>
        </ClientOnly>

        <div class="urls">
          <div class="url-row">
            <span class="tag">HLS</span>
            <input class="input mono" :value="c.hls" readonly />
            <button class="btn" @click="copy(c.hls)">Nusxa</button>
          </div>
          <div class="url-row">
            <span class="tag">Embed</span>
            <input class="input mono" :value="c.embed" readonly />
            <button class="btn" @click="copy(c.embed)">Nusxa</button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
h1 {
  margin: 0;
  font-size: 22px;
}
.muted {
  color: var(--muted);
}
.err {
  color: var(--danger);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px;
}
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}
.card-head h3 {
  margin: 0 0 2px;
  font-size: 16px;
}
.slug {
  font-size: 12px;
  color: var(--muted);
}
.preview-stub {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border: 1px dashed var(--line);
  border-radius: 10px;
  color: var(--accent);
  cursor: pointer;
  font-size: 15px;
}
.urls {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}
.url-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tag {
  font-size: 11px;
  color: var(--muted);
  width: 46px;
  flex: none;
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
</style>
