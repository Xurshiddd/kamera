<script setup lang="ts">
const cfg = useRuntimeConfig();
const route = useRoute();
const router = useRouter();
const { clear } = useAuth();

// Login sahifasida navigatsiya/chiqish tugmasi ko'rinmasin.
const onLogin = computed(() => route.path === "/login");

async function logout() {
  clear();
  await router.push("/login");
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <NuxtLink to="/" class="brand">
        <span class="dot" />
        Kamera boshqaruvi
      </NuxtLink>
      <nav v-if="!onLogin" class="nav">
        <NuxtLink to="/">Kameralar</NuxtLink>
        <NuxtLink to="/add">+ Qo'shish</NuxtLink>
        <button class="logout" @click="logout">Chiqish</button>
      </nav>
    </header>

    <main class="main">
      <NuxtPage />
    </main>

    <footer class="foot">
      Server: <code>{{ cfg.public.serviceBase || "sozlanmagan" }}</code>
    </footer>
  </div>
</template>

<style>
:root {
  --bg: #0e1116;
  --panel: #161b22;
  --panel-2: #1c232d;
  --line: #2a323d;
  --text: #e6edf3;
  --muted: #8b97a6;
  --accent: #4cc2ff;
  --ok: #3fb950;
  --danger: #f85149;
  --radius: 12px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}
html,
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 650;
  letter-spacing: 0.2px;
  color: var(--text);
  text-decoration: none;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 3px rgba(63, 185, 80, 0.18);
}
.nav {
  display: flex;
  gap: 18px;
}
.nav a {
  color: var(--muted);
  text-decoration: none;
  font-size: 14px;
}
.nav a.router-link-exact-active {
  color: var(--accent);
}
.nav .logout {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
  padding: 0;
}
.nav .logout:hover {
  color: var(--danger);
}

.main {
  flex: 1;
  width: 100%;
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px 20px;
}

.foot {
  padding: 12px 20px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
code {
  background: var(--panel-2);
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 12px;
}

/* umumiy elementlar */
.btn {
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--text);
  padding: 9px 14px;
  border-radius: 9px;
  font-size: 14px;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--accent);
}
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #04212f;
  font-weight: 600;
}
.btn-danger {
  color: var(--danger);
}
.input {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--line);
  color: var(--text);
  padding: 10px 12px;
  border-radius: 9px;
  font-size: 14px;
}
.input:focus {
  outline: none;
  border-color: var(--accent);
}
.label {
  display: block;
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 6px;
}
</style>
