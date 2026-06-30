<script setup lang="ts">
const { add } = useCameras();
const router = useRouter();

const form = reactive<NewCamera>({
  name: "",
  ip: "",
  port: 554,
  login: "",
  parol: "",
  rtspPath: "",
});

const brand = ref<"hikvision" | "dahua" | "custom">("hikvision");
const rtspByBrand: Record<string, string> = {
  hikvision: "Streaming/Channels/101",
  dahua: "cam/realmonitor?channel=1&subtype=0",
  custom: "",
};

const saving = ref(false);
const error = ref("");

async function submit() {
  error.value = "";
  if (!form.name || !form.ip || !form.login || !form.parol) {
    error.value = "Nom, IP, login va parol majburiy.";
    return;
  }
  saving.value = true;
  try {
    const payload: NewCamera = {
      ...form,
      rtspPath: brand.value === "custom" ? form.rtspPath : rtspByBrand[brand.value],
    };
    await add(payload);
    router.push("/");
  } catch (e: any) {
    error.value = e?.data?.error || "Qo'shishda xatolik (service ulanmadi?).";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="wrap">
    <h1>Yangi kamera</h1>
    <p class="muted">
      Login va parol faqat serverda saqlanadi — tashqi URL'da ko'rinmaydi.
    </p>

    <div class="form">
      <div>
        <label class="label">Nom</label>
        <input v-model="form.name" class="input" placeholder="Masalan: 1-qavat dahliz" />
      </div>

      <div class="row">
        <div style="flex: 2">
          <label class="label">Kamera IP</label>
          <input v-model="form.ip" class="input" placeholder="192.168.1.64" />
        </div>
        <div style="flex: 1">
          <label class="label">Port</label>
          <input v-model.number="form.port" class="input" type="number" />
        </div>
      </div>

      <div class="row">
        <div style="flex: 1">
          <label class="label">Login</label>
          <input v-model="form.login" class="input" placeholder="admin" />
        </div>
        <div style="flex: 1">
          <label class="label">Parol</label>
          <input v-model="form.parol" class="input" type="password" />
        </div>
      </div>

      <div>
        <label class="label">Kamera brendi</label>
        <select v-model="brand" class="input">
          <option value="hikvision">Hikvision</option>
          <option value="dahua">Dahua</option>
          <option value="custom">Boshqa (qo'lda)</option>
        </select>
      </div>

      <div v-if="brand === 'custom'">
        <label class="label">RTSP yo'li</label>
        <input v-model="form.rtspPath" class="input mono" placeholder="Streaming/Channels/101" />
      </div>
      <p v-else class="hint mono">RTSP yo'li: {{ rtspByBrand[brand] }}</p>

      <p v-if="error" class="err">{{ error }}</p>

      <div class="actions">
        <NuxtLink to="/" class="btn">Bekor qilish</NuxtLink>
        <button class="btn btn-primary" :disabled="saving" @click="submit">
          {{ saving ? "Saqlanmoqda…" : "Qo'shish" }}
        </button>
      </div>
    </div>
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
.form {
  display: grid;
  gap: 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 20px;
}
.row {
  display: flex;
  gap: 12px;
}
.hint {
  color: var(--muted);
  font-size: 12px;
  margin: 0;
}
.mono {
  font-family: ui-monospace, monospace;
}
.err {
  color: var(--danger);
  margin: 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
