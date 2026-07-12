<script setup lang="ts">
// Qo'shish va tahrirlash sahifalari uchun umumiy forma.
const props = defineProps<{
  mode: "add" | "edit";
  initial?: Partial<CameraDetail>;
  saving?: boolean;
  error?: string;
}>();
const emit = defineEmits<{ (e: "submit", payload: NewCamera): void }>();

const rtspByBrand: Record<string, string> = {
  hikvision: "Streaming/Channels/101",
  dahua: "cam/realmonitor?channel=1&subtype=0",
};

const form = reactive({
  name: props.initial?.name || "",
  ip: props.initial?.ip || "",
  port: props.initial?.port || 554,
  login: props.initial?.login || "",
  parol: "",
  rtspPath: props.initial?.rtsp_path || "",
  // number input bo'shatilsa "" bo'ladi — submit'da null'ga aylantiramiz
  order: (props.initial?.order ?? null) as number | "" | null,
});

// Mavjud RTSP yo'li brend namunasiga mos kelsa — o'sha brend tanlangan turadi.
function detectBrand(path: string) {
  if (props.mode === "add" && !path) return "hikvision";
  if (path === rtspByBrand.hikvision) return "hikvision";
  if (path === rtspByBrand.dahua) return "dahua";
  return "custom";
}
const brand = ref<"hikvision" | "dahua" | "custom">(detectBrand(form.rtspPath));

const localError = ref("");

function submit() {
  localError.value = "";
  const parolRequired = props.mode === "add";
  if (!form.name || !form.ip || !form.login || (parolRequired && !form.parol)) {
    localError.value = parolRequired
      ? "Nom, IP, login va parol majburiy."
      : "Nom, IP va login majburiy.";
    return;
  }
  emit("submit", {
    name: form.name,
    ip: form.ip,
    port: Number(form.port) || 554,
    login: form.login,
    parol: form.parol,
    rtspPath: brand.value === "custom" ? form.rtspPath : rtspByBrand[brand.value],
    order: form.order === "" || form.order === null ? null : Number(form.order),
  });
}
</script>

<template>
  <div class="form">
    <div>
      <label class="label">Nom</label>
      <input v-model="form.name" class="input" placeholder="Masalan: 1-qavat dahliz" />
      <p v-if="mode === 'edit'" class="hint">
        Nom o'zgarsa ham HLS manzili (slug) o'zgarmaydi — embed'lar buzilmaydi.
      </p>
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
        <input
          v-model="form.parol"
          class="input"
          type="password"
          :placeholder="mode === 'edit' ? 'Oʼzgartirmaslik uchun boʼsh qoldiring' : ''"
        />
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

    <div>
      <label class="label">Tartib raqami (ixtiyoriy)</label>
      <input
        v-model.number="form.order"
        class="input"
        type="number"
        min="1"
        placeholder="—"
      />
      <p class="hint">
        Ro'yxatda nechanchi bo'lib chiqadi (1 — birinchi). Bo'sh qoldirilsa
        tartib berilgan kameralardan keyin joylashadi.
      </p>
    </div>

    <p v-if="localError || error" class="err">{{ localError || error }}</p>

    <div class="actions">
      <NuxtLink to="/admin" class="btn">Bekor qilish</NuxtLink>
      <button class="btn btn-primary" :disabled="saving" @click="submit">
        <template v-if="saving">
          {{ mode === "add" ? "Qo'shilmoqda…" : "Saqlanmoqda…" }}
        </template>
        <template v-else>{{ mode === "add" ? "Qo'shish" : "Saqlash" }}</template>
      </button>
    </div>
    <p v-if="saving" class="hint">
      Kamera kodegi (H.264/H.265) tekshirilmoqda — bu 5–20 sekund olishi mumkin.
    </p>
  </div>
</template>

<style scoped>
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
  margin: 6px 0 0;
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
