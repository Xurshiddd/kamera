<script setup lang="ts">
definePageMeta({ permission: "cameras.manage" });

const { add } = useCameras();
const router = useRouter();

const saving = ref(false);
const error = ref("");
const errorField = ref("");

async function submit(payload: NewCamera) {
  error.value = "";
  errorField.value = "";
  saving.value = true;
  try {
    await add(payload);
    router.push("/admin");
  } catch (e: any) {
    error.value = e?.data?.error || "Qo'shishda xatolik (service ulanmadi?).";
    errorField.value = e?.data?.field || "";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="wrap">
    <div class="page-head">
      <div>
        <h1>Yangi kamera</h1>
        <p class="sub">
      Login va parol faqat serverda saqlanadi — tashqi URL'da ko'rinmaydi.
        </p>
      </div>
    </div>
    <CameraForm mode="add" :saving="saving" :error="error"
      :error-field="errorField" @submit="submit" />
  </section>
</template>

<style scoped>
.wrap {
  max-width: 560px;
}
</style>
