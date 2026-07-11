<script setup lang="ts">
const route = useRoute();
const router = useRouter();
const { clear } = useAuth();

// Login sahifasida navigatsiya/chiqish tugmasi ko'rinmasin.
const onLogin = computed(() => route.path === "/login");
// "/" — mehmon (guest) jonli sahifa: admin panel/topbar chiqmaydi,
// sahifa butun ekranni o'zi boshqaradi.
const isGuest = computed(() => route.path === "/");

async function logout() {
  clear();
  await router.push("/login");
}
</script>

<template>
  <div class="app">
    <header v-if="!isGuest" class="topbar">
      <NuxtLink to="/admin" class="brand">
        <span class="dot" />
        Kamera boshqaruvi
      </NuxtLink>
      <nav v-if="!onLogin" class="nav">
        <NuxtLink to="/admin">Kameralar</NuxtLink>
        <NuxtLink to="/add">+ Qo'shish</NuxtLink>
        <NuxtLink to="/status">Server holati</NuxtLink>
        <NuxtLink to="/">Jonli sahifa</NuxtLink>
        <button class="logout" @click="logout">Chiqish</button>
      </nav>
    </header>

    <main class="main" :class="{ 'main-full': isGuest }">
      <NuxtPage />
    </main>

    <footer v-if="!isGuest" class="foot">MediaMTX + HLS — kameralar jonli efirda</footer>
  </div>
</template>

<style>
:root {
  --bg: #0b0e13;
  --panel: #141922;
  --panel-2: #1b2230;
  --line: #263041;
  --text: #e6edf3;
  --muted: #8b97a6;
  --accent: #4cc2ff;
  --ok: #3fb950;
  --warn: #d29922;
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
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  backdrop-filter: blur(8px);
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
  align-items: center;
  gap: 18px;
}
.nav a {
  color: var(--muted);
  text-decoration: none;
  font-size: 14px;
  transition: color 0.15s ease;
}
.nav a:hover {
  color: var(--text);
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
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 20px;
}
/* Mehmon sahifasi butun ekranni oladi — chegara/padding yo'q */
.main-full {
  max-width: none;
  padding: 0;
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--text);
  padding: 9px 14px;
  border-radius: 9px;
  font-size: 14px;
  cursor: pointer;
  text-decoration: none;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.btn:hover {
  border-color: var(--accent);
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.btn-sm {
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 8px;
}
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #04212f;
  font-weight: 600;
}
.btn-primary:hover {
  filter: brightness(1.08);
}
.btn-danger {
  color: var(--danger);
}
.btn-danger:hover {
  border-color: var(--danger);
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
  box-shadow: 0 0 0 3px rgba(76, 194, 255, 0.15);
}
.label {
  display: block;
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 6px;
}

/* kodek/holat belgilari */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  border: 1px solid transparent;
}
.badge-ok {
  color: var(--ok);
  background: rgba(63, 185, 80, 0.12);
  border-color: rgba(63, 185, 80, 0.35);
}
.badge-warn {
  color: var(--warn);
  background: rgba(210, 153, 34, 0.12);
  border-color: rgba(210, 153, 34, 0.35);
}
.badge-muted {
  color: var(--muted);
  background: var(--panel-2);
  border-color: var(--line);
}
</style>
