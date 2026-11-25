<script setup lang="ts">
definePageMeta({ permission: "cameras.manage" });

const { list, remove, duplicates, cleanDuplicates } = useCameras();
const { can } = useAuth();
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
// Manba filtri: "" = hammasi, "nvr:<id>" = shu NVR, "manual" = NVR'siz
// (qo'lda yoki skaner orqali), "scan" = faqat skaner orqali qo'shilganlar.
const src = ref(typeof route.query.src === "string" ? route.query.src : "");
const sources = computed(() => {
  const nvrs = new Map<number, { name: string; n: number }>();
  let manual = 0;
  let scan = 0;
  for (const c of cameras.value) {
    if (c.nvr_id) {
      const e = nvrs.get(c.nvr_id) || { name: c.nvr_name || `NVR #${c.nvr_id}`, n: 0 };
      e.n++;
      nvrs.set(c.nvr_id, e);
    } else {
      manual++;
      if (c.source === "scan") scan++;
    }
  }
  return {
    nvrs: [...nvrs].map(([id, e]) => ({ value: `nvr:${id}`, text: `${e.name} (${e.n})` })).sort((a, b) => a.text.localeCompare(b.text)),
    manual,
    scan,
  };
});
const bySource = (c: Camera) => {
  if (!src.value) return true;
  if (src.value === "manual") return !c.nvr_id;
  if (src.value === "scan") return !c.nvr_id && c.source === "scan";
  return src.value === `nvr:${c.nvr_id}`;
};
const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  return cameras.value.filter(
    (c) =>
      bySource(c) &&
      (!s || c.name.toLowerCase().includes(s) || c.slug.includes(s) || String(c.channel ?? "") === s)
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
watch([q, src], () => (page.value = 1));
watch(src, (v) => router.replace({ query: { ...route.query, src: v || undefined, page: undefined } }));
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

// Bir xil IP'li kameralar: NVR'dagisi qoladi; ikkalasi NVR'da yoki ikkalasi
// skaner orqali bo'lsa — yangi qo'shilgani qoladi (qoidalar serverda).
const dup = ref<{ groups: DupGroup[]; total: number } | null>(null);
const dupBusy = ref(false);
const dupMsg = ref("");
async function openDup() {
  dupBusy.value = true;
  dupMsg.value = "";
  try {
    dup.value = await duplicates();
  } catch (e: any) {
    dupMsg.value = e?.data?.error || "Takrorlarni tekshirib boʻlmadi";
  } finally {
    dupBusy.value = false;
  }
}
async function runDup() {
  dupBusy.value = true;
  try {
    const r = await cleanDuplicates();
    dup.value = null;
    dupMsg.value = `${r.removed} ta ortiqcha kamera oʻchirildi`;
    await reload();
  } catch (e: any) {
    dupMsg.value = e?.data?.error || "Oʻchirishda xato";
  } finally {
    dupBusy.value = false;
  }
}
function dupLabel(d: DupItem) {
  if (d.source === "nvr") return `${d.nvr_name || "NVR"} · kanal ${d.channel}`;
  return d.source === "scan" ? "Skaner orqali" : "Qoʻlda qoʻshilgan";
}

// STREAM_BASE nisbiy (/hls) bo'lishi mumkin — nusxa/ko'rsatish uchun to'liq
// manzilga aylantiramiz (qaysi host orqali kirilgan bo'lsa, o'sha).
function absUrl(u: string) {
  try {
    return new URL(u, location.href).href;
  } catch {
    return u;
  }
}

async function copy(c: Camera) {
  if (await copyText(absUrl(c.hls))) {
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
          {{ filtered.length === cameras.length ? `${cameras.length} ta kamera` : `${filtered.length} / ${cameras.length} ta kamera` }}
        </p>
      </div>
      <div class="head-tools">
        <input v-model="q" class="input search" placeholder="Nom yoki kanal…" aria-label="Qidirish" />
        <select v-model="src" class="input src" aria-label="Manba boʻyicha filtr">
          <option value="">Hammasi ({{ cameras.length }})</option>
          <optgroup v-if="sources.nvrs.length" label="NVR orqali">
            <option v-for="o in sources.nvrs" :key="o.value" :value="o.value">{{ o.text }}</option>
          </optgroup>
          <optgroup label="NVR’siz">
            <option value="manual">Qoʻlda qoʻshilgan ({{ sources.manual }})</option>
            <option value="scan">— shundan skaner orqali ({{ sources.scan }})</option>
          </optgroup>
        </select>
        <button class="btn" :disabled="dupBusy" title="Bir xil IP'li kameralardan ortiqchasini oʻchirish" @click="openDup">
          {{ dupBusy && !dup ? "Tekshirilmoqda…" : "Takrorlarni tozalash" }}
        </button>
        <NuxtLink to="/nvrs" class="btn">NVR'dan import</NuxtLink>
        <NuxtLink v-if="can('discovery.manage')" to="/discovery" class="btn">Tarmoqdan topish</NuxtLink>
        <NuxtLink to="/add" class="btn btn-primary">+ Kamera qo'shish</NuxtLink>
      </div>
    </div>

    <p v-if="dupMsg" class="muted dup-msg">{{ dupMsg }}</p>

    <div v-if="dup" class="overlay" role="alertdialog" aria-modal="true" aria-labelledby="dup-t" @click.self="dup = null">
      <div class="panel dialog">
        <h2 id="dup-t">Bir xil IP'li kameralar</h2>
        <p v-if="!dup.total" class="muted">Takror kamera topilmadi — hamma IP'lar yagona.</p>
        <template v-else>
          <p class="muted">
            {{ dup.groups.length }} ta IP'da takror bor, <b>{{ dup.total }}</b> ta ortiqcha kamera oʻchiriladi.
            NVR'dagi kamera qoladi; ikkalasi NVR'da yoki ikkalasi skaner orqali boʻlsa — yangi qoʻshilgani qoladi.
            Guruh va topologiya bogʻlanishlari qoladigan kameraga oʻtkaziladi.
          </p>
          <div class="dup-list">
            <div v-for="g in dup.groups" :key="g.ip" class="dup-g">
              <div class="mono dup-ip">{{ g.ip }}</div>
              <div class="dup-row keep">✓ Qoladi: <b>{{ g.keep.name }}</b> <span class="muted">— {{ dupLabel(g.keep) }}, {{ fmtUtc(g.keep.created_at, false) }}</span></div>
              <div v-for="r in g.remove" :key="r.id" class="dup-row del">✕ Oʻchadi: <b>{{ r.name }}</b> <span class="muted">— {{ dupLabel(r) }}, {{ fmtUtc(r.created_at, false) }}</span></div>
            </div>
          </div>
        </template>
        <div class="dup-actions">
          <button class="btn" :disabled="dupBusy" @click="dup = null">Bekor qilish</button>
          <button v-if="dup.total" class="btn btn-danger" :disabled="dupBusy" @click="runDup">
            {{ dupBusy ? "Oʻchirilmoqda…" : `${dup.total} ta ortiqchani oʻchirish` }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="loading" class="muted">Yuklanmoqda…</p>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="!cameras.length" class="muted">
      Hali kamera yo'q. Yuqoridagi tugma orqali birinchisini qo'shing.
    </p>
    <p v-else-if="!filtered.length" class="muted">Bu filtrda kamera yoʻq.</p>

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
              <span v-else-if="c.source === 'scan'" class="badge badge-live" :title="`Tarmoq skaneri orqali · ${c.ip}`">Skaner · {{ c.ip }}</span>
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
          <input class="input mono url-input" :value="absUrl(c.hls)" readonly @focus="($event.target as HTMLInputElement).select()" />
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
.overlay { position: fixed; inset: 0; background: rgba(17, 24, 39, 0.5); display: grid; place-items: center; z-index: 50; padding: 16px; }
.dialog { max-width: 680px; width: 100%; margin: 0; max-height: 90vh; display: flex; flex-direction: column; }
.dialog h2 { margin: 0 0 8px; }
.dup-list { overflow: auto; border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; margin: 8px 0 12px; }
.dup-g { padding: 8px 0; border-bottom: 1px solid var(--line); }
.dup-g:last-child { border-bottom: 0; }
.dup-ip { font-weight: 700; margin-bottom: 4px; }
.dup-row { font-size: 16px; padding: 2px 0; }
.dup-row.keep { color: var(--ok); }
.dup-row.del { color: var(--danger, #b91c1c); }
.dup-actions { display: flex; gap: 8px; justify-content: flex-end; }
.dup-msg { margin-top: 0; }
.head-tools {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.search {
  width: 200px;
}
.src {
  width: auto;
  max-width: 100%;
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
