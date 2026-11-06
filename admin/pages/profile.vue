<script setup lang="ts">
const { me } = useAuth();
const { call } = useApi();
const current = ref("");
const next = ref("");
const next2 = ref("");
const saving = ref(false);
const error = ref("");
const done = ref(false);

async function submit() {
  error.value = "";
  done.value = false;
  if (next.value.length < 8) return (error.value = "Yangi parol kamida 8 belgi.");
  if (next.value !== next2.value) return (error.value = "Yangi parollar mos emas.");
  saving.value = true;
  try {
    await call("/api/me/password", {
      method: "POST",
      body: { current: current.value, next: next.value },
    });
    done.value = true;
    current.value = next.value = next2.value = "";
  } catch (e: any) {
    error.value = e?.data?.error || "Saqlab bo'lmadi.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section style="max-width: 460px">
    <div class="page-head">
      <div>
        <h1>Profil</h1>
        <p v-if="me" class="sub">
          {{ me.full_name || me.username }} · <span class="mono">{{ me.username }}</span> ·
          {{ me.roles.join(", ") || "rolsiz" }}
        </p>
      </div>
    </div>
    <form class="panel" @submit.prevent="submit">
      <strong>Parolni almashtirish</strong>
      <div>
        <label class="label">Joriy parol</label>
        <input v-model="current" class="input" type="password" autocomplete="current-password" />
      </div>
      <div>
        <label class="label">Yangi parol (kamida 8 belgi)</label>
        <input v-model="next" class="input" type="password" autocomplete="new-password" />
      </div>
      <div>
        <label class="label">Yangi parol (takror)</label>
        <input v-model="next2" class="input" type="password" autocomplete="new-password" />
      </div>
      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="done" class="ok-text">Parol almashtirildi.</p>
      <div class="actions">
        <button class="btn btn-primary" :disabled="saving" type="submit">
          {{ saving ? "Saqlanmoqda…" : "Saqlash" }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.mono {
  font-family: ui-monospace, monospace;
}
</style>
