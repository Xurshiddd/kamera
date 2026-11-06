<script setup lang="ts">
definePageMeta({ permission: "cameras.manage" });

const { list, remove } = useCameras();

const cameras = ref<Camera[]>([]);
const loading = ref(true);
const error = ref("");
const copiedId = ref<number | null>(null);
const q = ref("");
// Oqim faqat "Ko'rish" bosilganda ochiladi — 100+ kamera birdan tortilmasin.
const playing = ref(new Set<number>());
const toggle = (id: number) => {
  const s = new Set(playing.value);
  s.has(id) ? s.delete(id) : s.add(id);
  playing.value = s;
};
const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (!s) return cameras.value;
  return cameras.value.filter(
    (c) => c.name.toLowerCase().includes(s) || c.slug.includes(s) || String(c.channel ?? "") === s
  );
});

async function reload() {
  loading.value = true;
  error.value = "";
  try {
    const data = await list();
    // Himoya: service o'rniga (proxy/backend noto'g'ri bo'lsa) HTML yoki xato
    // qaytsa, uni harflab "kamera" qilib chizmaymiz — bo'sh ro'yxat ko'rsatamiz.
    if (!Array.isArray(data)) throw new Error("Kutilmagan javob (massiv emas)");
    cameras.value = data;
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

async function copy(c: Camera) {
  if (await copyText(c.hls)) {
    copiedId.value = c.id;
    setTimeout(() => {
      if (copiedId.value === c.id) copiedId.value = null;
    }, 1600);
  }
}

function codecBadge(c: Camera) {
  if (c.codec === "h264") return { label: "H.264", title: "To'g'ridan-to'g'ri (transkodsiz)", cls: "badge-ok" };
  if (c.codec === "hevc") return { label: "H.265", title: "H.264 ga transkod qilinadi", cls: "badge-warn" };
  return { label: "Kodek ?", title: "Kodek aniqlanmagan (kamera o'chiq bo'lishi mumkin)", cls: "badge-muted" };
}

onMounted(reload);
</script>

<template>
  <section>
    <div class="head">
      <div>
        <h1>Kameralar</h1>
        <p v-if="!loading && cameras.length" class="sub">
          {{ cameras.length }} ta kamera
        </p>
      </div>
      <div class="head-tools">
        <input v-model="q" class="input search" placeholder="Nom yoki kanal…" />
        <NuxtLink to="/nvrs" class="btn">NVR'dan import</NuxtLink>
        <NuxtLink to="/add" class="btn btn-primary">+ Kamera qo'shish</NuxtLink>
      </div>
    </div>

    <p v-if="loading" class="muted">Yuklanmoqda…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="!cameras.length" class="muted">
      Hali kamera yo'q. Yuqoridagi tugma orqali birinchisini qo'shing.
    </p>

    <div v-else class="grid">
      <article v-for="c in filtered" :key="c.id" class="card">
        <div class="card-head">
          <div class="title">
            <h3>{{ c.name }}</h3>
            <div class="meta">
              <span
                v-if="c.order != null"
                class="badge badge-muted"
                title="Ko'rsatish tartibi"
              >
                № {{ c.order }}
              </span>
              <span v-if="c.nvr_id" class="badge badge-ok" :title="`${c.nvr_name} · kanal ${c.channel}`">
                NVR · {{ c.channel }}
              </span>
              <span v-else class="slug mono">{{ c.slug }}</span>
              <span
                v-if="c.is_public === false"
                class="badge badge-muted"
                title="Mehmon sahifasida ko'rinmaydi"
              >
                Yopiq
              </span>
              <span
                class="badge"
                :class="codecBadge(c).cls"
                :title="codecBadge(c).title"
              >
                {{ codecBadge(c).label }}
              </span>
            </div>
          </div>
          <div class="tools">
            <NuxtLink :to="`/edit/${c.id}`" class="btn btn-sm">Tahrirlash</NuxtLink>
            <button class="btn btn-sm btn-danger" @click="onDelete(c)">O'chirish</button>
          </div>
        </div>

        <ClientOnly>
          <!-- Ochilmasa pleyer o'zi har 5s da qayta urinadi (HlsPlayer) -->
          <HlsPlayer v-if="playing.has(c.id)" :src="c.hls" :camera-id="c.id" />
          <button v-else class="ph" @click="toggle(c.id)">▶ Ko'rish</button>
        </ClientOnly>

        <div class="url-row">
          <span class="tag">HLS</span>
          <input class="input mono url-input" :value="c.hls" readonly @focus="($event.target as HTMLInputElement).select()" />
          <button class="btn btn-sm" :class="{ copied: copiedId === c.id }" @click="copy(c)">
            {{ copiedId === c.id ? "✓ Nusxalandi" : "Nusxa" }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 18px;
}
h1 {
  margin: 0;
  font-size: 22px;
}
.sub {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
}
.muted {
  color: var(--muted);
}
.err {
  color: var(--danger);
}
.head-tools {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.search {
  width: 200px;
}
.ph {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  border: 1px dashed var(--line);
  background: #000;
  color: var(--muted);
  font-size: 15px;
  cursor: pointer;
}
.ph:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px;
  transition: border-color 0.15s ease, transform 0.15s ease;
}
.card:hover {
  border-color: #3a4551;
}
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.title h3 {
  margin: 0 0 4px;
  font-size: 16px;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.slug {
  font-size: 12px;
  color: var(--muted);
}
.tools {
  display: flex;
  gap: 6px;
  flex: none;
}
.url-row {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.tag {
  font-size: 11px;
  color: var(--muted);
  flex: none;
}
.url-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  font-size: 12px;
}
.mono {
  font-family: ui-monospace, monospace;
}
.copied {
  color: var(--ok);
  border-color: var(--ok);
}
</style>
