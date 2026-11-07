<script setup lang="ts">
// Raqamli sahifalash: ‹ Oldingi  1 … 4 [5] 6 … 20  Keyingi ›
// v-model — joriy sahifa (1 dan). `info` — "1–12 / jami 101" kabi matn.
const props = defineProps<{ modelValue: number; pages: number; info?: string }>();
const emit = defineEmits<{ "update:modelValue": [p: number] }>();

const go = (p: number) => {
  const v = Math.min(Math.max(p, 1), props.pages);
  if (v !== props.modelValue) emit("update:modelValue", v);
};

const list = computed<(number | "…")[]>(() => {
  const n = props.pages, c = props.modelValue;
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const a = Math.max(2, c - 1), b = Math.min(n - 1, c + 1);
  if (a > 2) out.push("…");
  for (let i = a; i <= b; i++) out.push(i);
  if (b < n - 1) out.push("…");
  out.push(n);
  return out;
});
</script>

<template>
  <nav v-if="pages > 1 || info" class="pager" aria-label="Sahifalar">
    <span v-if="info" class="info">{{ info }}</span>
    <template v-if="pages > 1">
      <button class="btn" :disabled="modelValue <= 1" @click="go(modelValue - 1)">‹ Oldingi</button>
      <template v-for="(p, i) in list" :key="i">
        <span v-if="p === '…'" class="gap" aria-hidden="true">…</span>
        <button
          v-else
          class="btn num"
          :class="{ 'btn-primary': p === modelValue }"
          :aria-current="p === modelValue ? 'page' : undefined"
          :aria-label="`${p}-sahifa`"
          @click="go(p)"
        >
          {{ p }}
        </button>
      </template>
      <button class="btn" :disabled="modelValue >= pages" @click="go(modelValue + 1)">Keyingi ›</button>
    </template>
  </nav>
</template>

<style scoped>
.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 24px;
}
.info {
  width: 100%;
  text-align: center;
  font-size: 18px;
  font-weight: 600;
  color: #374151;
}
.num {
  min-width: 52px;
  padding: 0 10px;
}
.gap {
  padding: 0 4px;
  font-size: 20px;
  color: var(--muted);
}
</style>
