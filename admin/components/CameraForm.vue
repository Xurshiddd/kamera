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

// Manba: NVR kanali yoki to'g'ridan IP kamera.
interface NvrItem { id: number; name: string; ip: string }
const nvrs = ref<NvrItem[]>([]);
const { call } = useApi();
onMounted(async () => {
  try {
    nvrs.value = await call<NvrItem[]>("/api/nvrs");
    if (props.mode === "add" && nvrs.value.length && !form.nvrId) form.nvrId = nvrs.value[0].id;
  } catch {
    /* NVR ro'yxati bo'lmasa faqat IP rejimi */
  }
});

const form = reactive({
  source: (props.initial?.nvr_id || props.mode === "add" ? "nvr" : "ip") as "nvr" | "ip",
  nvrId: (props.initial?.nvr_id ?? null) as number | null,
  channel: (props.initial?.channel ?? null) as number | "" | null,
  stream: (props.initial?.stream || "main") as "main" | "sub",
  name: props.initial?.name || "",
  ip: props.initial?.ip || "",
  port: props.initial?.port || 554,
  login: props.initial?.login || "",
  parol: "",
  rtspPath: props.initial?.rtsp_path || "",
  // number input bo'shatilsa "" bo'ladi — submit'da null'ga aylantiramiz
  order: (props.initial?.order ?? null) as number | "" | null,
  isPublic: props.initial?.is_public ?? true,
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
  const common = {
    name: form.name,
    order: form.order === "" || form.order === null ? null : Number(form.order),
    isPublic: form.isPublic,
  };
  if (form.source === "nvr") {
    if (!form.name || !form.nvrId || !form.channel) {
      localError.value = "Nom, NVR va kanal raqami majburiy.";
      return;
    }
    emit("submit", {
      ...common,
      nvrId: form.nvrId,
      channel: Number(form.channel),
      stream: form.stream,
    });
    return;
  }
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
    isPublic: form.isPublic,
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

    <div v-if="mode === 'add'">
      <label class="label">Manba</label>
      <select v-model="form.source" class="input">
        <option value="nvr">NVR kanali</option>
        <option value="ip">To'g'ridan IP kamera</option>
      </select>
    </div>

    <template v-if="form.source === 'nvr'">
      <div class="row">
        <div style="flex: 2">
          <label class="label">NVR</label>
          <select v-model.number="form.nvrId" class="input">
            <option v-for="n in nvrs" :key="n.id" :value="n.id">{{ n.name }} ({{ n.ip }})</option>
          </select>
          <p v-if="!nvrs.length" class="hint">
            Hali NVR yo'q — avval <NuxtLink to="/nvrs">NVR</NuxtLink> sahifasida qo'shing.
          </p>
        </div>
        <div style="flex: 1">
          <label class="label">Kanal</label>
          <input v-model.number="form.channel" class="input" type="number" min="1" placeholder="1" />
        </div>
      </div>
      <div>
        <label class="label">Oqim</label>
        <select v-model="form.stream" class="input">
          <option value="main">Asosiy (yuqori sifat)</option>
          <option value="sub">Qo'shimcha (past sifat, H.265 bo'lsa transkod qilinadi)</option>
        </select>
      </div>
    </template>

    <template v-else>
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
    </template>

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

    <div>
      <label class="check">
        <input v-model="form.isPublic" type="checkbox" />
        <span>Mehmon sahifasida ochiq (loginsiz jonli ko'rinadi)</span>
      </label>
      <p class="hint">
        Belgilanmasa kamera faqat login qilgan va ruxsati bor xodimlarga ko'rinadi.
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
    <p v-if="saving && form.source === 'ip'" class="hint">
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
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
