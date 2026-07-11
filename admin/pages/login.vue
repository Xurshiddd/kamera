<script setup lang="ts">
const password = ref("");
const error = ref("");
const loading = ref(false);
const router = useRouter();
const route = useRoute();
const { call } = useApi();
const { set } = useAuth();

async function submit() {
  error.value = "";
  if (!password.value) {
    error.value = "Parolni kiriting.";
    return;
  }
  loading.value = true;
  try {
    // Parolni to'g'ridan service'ga yuboramiz, token olamiz va saqlaymiz.
    const { token } = await call<{ token: string }>("/api/login", {
      method: "POST",
      body: { password: password.value },
    });
    set(token);
    // Kirilgandan keyin admin sahifasiga (yoki kelingan sahifaga) o'tamiz.
    const back = (route.query.redirect as string) || "/admin";
    await router.push(back);
  } catch (e: any) {
    error.value = e?.data?.error || "Noto'g'ri parol.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="login-wrap">
    <form class="card" @submit.prevent="submit">
      <div class="logo">
        <span class="dot" />
        Kamera boshqaruvi
      </div>
      <p class="muted">Davom etish uchun parolni kiriting.</p>

      <div>
        <label class="label">Parol</label>
        <input
          v-model="password"
          class="input"
          type="password"
          placeholder="••••••••"
          autofocus
        />
      </div>

      <p v-if="error" class="err">{{ error }}</p>

      <button class="btn btn-primary" :disabled="loading" type="submit">
        {{ loading ? "Tekshirilmoqda…" : "Kirish" }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.login-wrap {
  min-height: 70vh;
  display: grid;
  place-items: center;
}
.card {
  width: 100%;
  max-width: 360px;
  display: grid;
  gap: 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 24px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 650;
  font-size: 17px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 3px rgba(63, 185, 80, 0.18);
}
.muted {
  color: var(--muted);
  margin: 0;
  font-size: 14px;
}
.err {
  color: var(--danger);
  margin: 0;
  font-size: 14px;
}
</style>
