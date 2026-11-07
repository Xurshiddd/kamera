<script setup lang="ts">
definePageMeta({ permission: "cameras.manage" });

const { list, remove } = useCameras();
const route = useRoute();
const router = useRouter();

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

// Sahifalash: 12 ta kartochka (3 ustun × 4 qator). Sahifa URL'da saqlanadi.
const PER = 12;
const page = ref(Math.max(1, Number(route.query.page) || 1));
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PER)));
const visible = computed(() => filtered.value.slice((page.value - 1) * PER, page.value * PER));
const pageInfo = computed(() =>
  filtered.value.length
    ? `${(page.value - 1) * PER + 1}–${Math.min(page.value * PER, filtered.value.length)} / jami ${filtered.value.length}`
    : ""
);
watch(q, () => (page.value = 1));
watch(pages, (n) => {
  if (page.value > n) page.value = n;
});
watch(page, (p) => {
  router.replace({ query: { ...route.query, page: p > 1 ? p : undefined } });
  window.scrollTo({ top: 0, behavior: "smooth" });
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
    <div class="page-head">
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
      <article v-for="c in visible" :key="c.id" class="card">
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
            <NuxtLink :to="`/edit/${c.id}`" class="btn icon-btn" :aria-label="`${c.name} — tahrirlash`" title="Tahrirlash">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
            </NuxtLink>
            <button class="btn icon-btn btn-danger" :aria-label="`${c.name} — oʻchirish`" title="Oʻchirish" @click="onDelete(c)">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M9 7V4h6v3" /></svg>
            </button>
          </div>
        </div>

        <ClientOnly>
          <!-- Ochilmasa pleyer o'zi har 5s da qayta urinadi (HlsPlayer) -->
          <HlsPlayer v-if="playing.has(c.id)" :src="c.hls" :camera-id="c.id" />
          <button v-else class="ph" @click="toggle(c.id)">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            Koʻrish
          </button>
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
    <Pager v-if="!loading && filtered.length" v-model="page" :pages="pages" :info="pageInfo" />
  </section>
</template>

<style scoped>
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
  border: 0;
  background: #1f2937;
  color: #f9fafb;
  font: inherit;
  font-size: 19px;
  font-weight: 600;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
}
.ph:hover {
  background: #111827;
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
  border-color: var(--accent);
}
.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.title {
  min-width: 0;
}
.title h3 {
  margin: 0 0 6px;
  font-size: 21px;
  overflow-wrap: anywhere;
}
.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.slug {
  font-size: 15px;
  color: var(--muted);
}
.tools {
  display: flex;
  gap: 8px;
  flex: none;
}
/* Faqat belgi: matn o'rnini aria-label/title bosadi; o'lchami 48x48 */
.icon-btn {
  width: 48px;
  min-height: 48px;
  padding: 0;
}
.url-row {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.tag {
  font-size: 15px;
  color: var(--muted);
  flex: none;
}
.url-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  font-size: 15px;
}
.copied {
  color: var(--ok);
  border-color: var(--ok);
}
</style>
