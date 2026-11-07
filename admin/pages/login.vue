<script setup lang="ts">
const username = ref("");
const password = ref("");
const showPw = ref(false);
const error = ref("");
const loading = ref(false);
const router = useRouter();
const route = useRoute();
const { call } = useApi();
const { set, loadMe, homePath } = useAuth();

async function submit() {
  error.value = "";
  if (!username.value || !password.value) {
    error.value = "Login va parolni kiriting.";
    return;
  }
  loading.value = true;
  try {
    const { token } = await call<{ token: string }>("/api/login", {
      method: "POST",
      body: { username: username.value.trim(), password: password.value },
    });
    set(token);
    await loadMe(true);
    const back = (route.query.redirect as string) || homePath();
    await router.push(back);
  } catch (e: any) {
    error.value = e?.data?.error || "Login yoki parol notoʻgʻri. Qaytadan kiriting.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="wrap">
    <div class="intro">
      <h1>Xush kelibsiz</h1>
      <p class="lead">
        Bu yerda auditoriyalarni jonli kuzatasiz, oʻtgan kunlar yozuvlarini koʻrasiz va kerakli qismini
        yuklab olasiz.
      </p>
      <ol class="steps">
        <li><span class="num">1</span>Login va parolingizni kiriting</li>
        <li><span class="num">2</span>«Jonli kuzatuv» yoki «Yozuvlar» boʻlimini tanlang</li>
        <li><span class="num">3</span>Xonani bosing — tasvir katta ochiladi</li>
      </ol>
    </div>

    <form class="card" @submit.prevent="submit">
      <h2>Tizimga kirish</h2>
      <div>
        <label class="label" for="login">Login</label>
        <input id="login" v-model="username" class="input big" autocomplete="username" autofocus />
      </div>
      <div>
        <label class="label" for="parol">Parol</label>
        <div class="pw">
          <input
            id="parol"
            v-model="password"
            class="input big"
            :type="showPw ? 'text' : 'password'"
            autocomplete="current-password"
          />
          <button type="button" class="btn btn-soft" @click="showPw = !showPw">
            {{ showPw ? "Yashirish" : "Koʻrsatish" }}
          </button>
        </div>
      </div>

      <p v-if="error" class="err" role="alert">{{ error }}</p>

      <button class="btn btn-primary submit" :disabled="loading" type="submit">
        {{ loading ? "Tekshirilmoqda…" : "Kirish" }}
      </button>
      <p class="help">Parolni unutdingizmi? Tizim administratoriga murojaat qiling.</p>
    </form>
  </section>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 48px;
  align-items: flex-start;
  padding: 24px 0;
}
.intro {
  flex: 1 1 420px;
  display: grid;
  gap: 24px;
}
h1 {
  margin: 0;
  font-size: 44px;
  line-height: 1.15;
}
.lead {
  margin: 0;
  font-size: 22px;
  line-height: 1.55;
  color: #374151;
  max-width: 560px;
}
.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 16px;
  font-size: 20px;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 16px;
}
.num {
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 50%;
  background: #dbeafe;
  color: var(--accent-dark);
  font-size: 22px;
  font-weight: 700;
  display: grid;
  place-items: center;
}
.card {
  flex: 1 1 440px;
  max-width: 520px;
  display: grid;
  gap: 22px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 36px;
  box-shadow: 0 4px 16px rgba(17, 24, 39, 0.06);
}
h2 {
  margin: 0;
  font-size: 32px;
}
.label {
  font-size: 20px;
}
.big {
  min-height: 60px;
  font-size: 21px;
}
.pw {
  display: flex;
  gap: 10px;
}
.pw .input {
  flex: 1;
  min-width: 0;
}
.pw .btn {
  min-height: 60px;
}
.submit {
  min-height: 64px;
  font-size: 22px;
}
.help {
  margin: 0;
  font-size: 18px;
  color: var(--muted);
}
</style>
