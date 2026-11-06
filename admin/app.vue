<script setup lang="ts">
const route = useRoute();
const router = useRouter();
const { clear, me, can, homePath } = useAuth();

// Menyu: har bir bo'lim faqat tegishli ruxsat bo'lsa ko'rinadi.
const links = computed(() =>
  [
    { to: "/live", label: "Jonli", perm: "live.view" },
    { to: "/playback", label: "Yozuvlar", perm: "playback.view" },
    { to: "/admin", label: "Kameralar", perm: "cameras.manage" },
    { to: "/nvrs", label: "NVR", perm: "nvr.manage" },
    { to: "/groups", label: "Guruhlar", perm: "groups.manage" },
    { to: "/users", label: "Foydalanuvchilar", perm: "users.manage" },
    { to: "/roles", label: "Rollar", perm: "roles.manage" },
    { to: "/audit", label: "Audit", perm: "audit.view" },
    { to: "/status", label: "Server holati", perm: "status.view" },
  ].filter((l) => can(l.perm))
);

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
      <NuxtLink :to="me ? homePath() : '/login'" class="brand">
        <span class="dot" />
        Kamera boshqaruvi
      </NuxtLink>
      <nav v-if="!onLogin && me" class="nav">
        <NuxtLink v-for="l in links" :key="l.to" :to="l.to">{{ l.label }}</NuxtLink>
        <NuxtLink to="/profile" class="who" title="Profil va parol">
          {{ me.full_name || me.username }}
        </NuxtLink>
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
.nav {
  flex-wrap: wrap;
  justify-content: flex-end;
}
.nav .who {
  padding-left: 14px;
  border-left: 1px solid var(--line);
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

/* jadval (boshqaruv sahifalari) */
.table {
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  font-size: 14px;
}
.table th,
.table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}
.table th {
  color: var(--muted);
  font-weight: 500;
  font-size: 12px;
  background: var(--panel-2);
}
.table tr:last-child td {
  border-bottom: none;
}
.table-wrap {
  overflow-x: auto;
}
.check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
}
.check input {
  margin-top: 3px;
  accent-color: var(--accent);
}
.checks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  max-height: 260px;
  overflow: auto;
  padding: 10px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 9px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}
.page-head h1 {
  margin: 0;
  font-size: 22px;
}
.page-head .sub {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
}
.panel {
  display: grid;
  gap: 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 18px;
  margin-bottom: 18px;
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 640px) {
  .row2 {
    grid-template-columns: 1fr;
  }
}
.muted {
  color: var(--muted);
}
.err {
  color: var(--danger);
  margin: 0;
}
.ok-text {
  color: var(--ok);
  margin: 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.hint {
  color: var(--muted);
  font-size: 12px;
  margin: 6px 0 0;
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
