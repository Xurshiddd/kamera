<script setup lang="ts">
// Sana kiritish: har doim KUN.OY.YIL ko'rinishida (brauzer tiliga bog'liq emas).
// v-model — ISO "YYYY-MM-DD" (yoki bo'sh satr). Kalendar tugmasi brauzerning
// o'z kalendarini ochadi (u faqat tanlash uchun, matn formati bizniki).
const props = defineProps<{ modelValue: string; min?: string; max?: string; placeholder?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string] }>();

const text = ref(fmtDate(props.modelValue));
const bad = ref(false);
const picker = ref<HTMLInputElement | null>(null);

watch(
  () => props.modelValue,
  (v) => {
    if (parseDate(text.value) !== v) text.value = fmtDate(v);
    bad.value = false;
  }
);

// Yozayotganda nuqtalarni o'zi qo'yadi: 07112026 -> 07.11.2026
function onInput(e: Event) {
  const el = e.target as HTMLInputElement;
  const digits = el.value.replace(/\D/g, "").slice(0, 8);
  let v = digits;
  if (digits.length > 4) v = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  else if (digits.length > 2) v = `${digits.slice(0, 2)}.${digits.slice(2)}`;
  text.value = v;
  bad.value = false;
  if (v.length === 10) commit();
}

function commit() {
  if (!text.value.trim()) {
    bad.value = false;
    if (props.modelValue) emit("update:modelValue", "");
    return;
  }
  const iso = parseDate(text.value);
  if (!iso || (props.max && iso > props.max) || (props.min && iso < props.min)) {
    bad.value = true;
    return;
  }
  bad.value = false;
  text.value = fmtDate(iso);
  if (iso !== props.modelValue) emit("update:modelValue", iso);
}

function openPicker() {
  const el = picker.value;
  if (!el) return;
  try {
    el.showPicker();
  } catch {
    el.focus();
  }
}
function onPick(e: Event) {
  const v = (e.target as HTMLInputElement).value;
  if (v) emit("update:modelValue", v);
}
</script>

<template>
  <span class="date-input" :class="{ bad }">
    <input
      :value="text"
      class="input mono"
      inputmode="numeric"
      maxlength="10"
      :placeholder="placeholder || 'kk.oo.yyyy'"
      :title="bad ? 'Sana noto\'g\'ri (kk.oo.yyyy)' : 'kk.oo.yyyy'"
      @input="onInput"
      @change="commit"
      @blur="commit"
      @keydown.enter.prevent="commit"
    />
    <button type="button" class="cal" title="Kalendar" aria-label="Kalendarni ochish" @click="openPicker">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" /></svg>
    </button>
    <input
      ref="picker"
      class="native"
      type="date"
      tabindex="-1"
      aria-hidden="true"
      :value="modelValue"
      :min="min"
      :max="max"
      @change="onPick"
    />
  </span>
</template>

<style scoped>
.date-input {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.date-input .input {
  width: 180px;
  padding-right: 48px;
}
.date-input.bad .input {
  border-color: var(--danger);
}
.cal {
  position: absolute;
  right: 4px;
  background: none;
  border: 0;
  cursor: pointer;
  color: var(--accent-dark);
  padding: 6px;
  line-height: 0;
  border-radius: 6px;
}
.native {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  border: 0;
  padding: 0;
}
</style>
