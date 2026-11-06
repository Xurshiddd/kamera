<script setup lang="ts">
definePageMeta({ permission: "cameras.manage" });

const route = useRoute();
const router = useRouter();
const { get, update } = useCameras();

const camera = ref<CameraDetail | null>(null);
const loadError = ref("");
const saving = ref(false);
const error = ref("");

onMounted(async () => {
  try {
    camera.value = await get(route.params.id as string);
  } catch {
    loadError.value = "Kamera topilmadi.";
  }
});

async function submit(payload: NewCamera) {
  error.value = "";
  saving.value = true;
  try {
    await update(route.params.id as string, payload);
    router.push("/admin");
  } catch (e: any) {
    error.value = e?.data?.error || "Saqlashda xatolik (service ulanmadi?).";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="wrap">
    <h1>Kamerani tahrirlash</h1>
    <p v-if="camera" class="muted">
      <span class="mono">{{ camera.slug }}</span> — saqlangach kodek qayta
      aniqlanadi va oqim yangi sozlama bilan qayta ishga tushadi.
    </p>

    <p v-if="loadError" class="err">{{ loadError }}</p>
    <CameraForm
      v-else-if="camera"
      mode="edit"
      :initial="camera"
      :saving="saving"
      :error="error"
      @submit="submit"
    />
    <p v-else class="muted">Yuklanmoqda…</p>
  </section>
</template>

<style scoped>
.wrap {
  max-width: 560px;
}
h1 {
  margin: 0 0 4px;
  font-size: 22px;
}
.muted {
  color: var(--muted);
  margin: 0 0 20px;
}
.mono {
  font-family: ui-monospace, monospace;
}
.err {
  color: var(--danger);
}
</style>
