<script setup lang="ts">
const route = useRoute();
const router = useRouter();
const { clear, me, can, homePath } = useAuth();

// Boshqaruv bo'limining ichki sahifalari — har biri faqat ruxsat bo'lsa.
const adminTabs = computed(() =>
  [
    { to: "/users", label: "Xodimlar", perm: "users.manage" },
    { to: "/nvr-cameras", label: "Kameralar (NVR)", perm: "nvr.manage" },
    { to: "/admin", label: "Kameralar roʻyxati", perm: "cameras.manage" },
    { to: "/groups", label: "Xona guruhlari", perm: "groups.manage" },
    { to: "/roles", label: "Rollar va huquqlar", perm: "roles.manage" },
    { to: "/nvrs", label: "NVR qurilmalar", perm: "nvr.manage" },
    { to: "/discovery", label: "Tarmoq skaneri", perm: "discovery.manage" },
    { to: "/netconfig", label: "Kamera IP/parol", perm: "netconfig.manage" },
    { to: "/topology", label: "Tarmoq sxemasi", perm: ["topology.view", "topology.manage"] },
    { to: "/audit", label: "Kirishlar tarixi", perm: "audit.view" },
    { to: "/status", label: "Server holati", perm: "status.view" },
  ].filter((t) => (Array.isArray(t.perm) ? t.perm.some(can) : can(t.perm)))
);
const adminPaths = ["/users", "/nvr-cameras", "/admin", "/add", "/edit", "/groups", "/roles", "/nvrs", "/discovery", "/netconfig", "/topology", "/audit", "/status"];
const inAdmin = computed(() => adminPaths.some((p) => route.path === p || route.path.startsWith(p + "/")));

// Asosiy menyu: 3 ta katta bo'lim.
const links = computed(() =>
  [
    { to: "/live", label: "Jonli kuzatuv", show: can("live.view"), active: route.path.startsWith("/live") },
    { to: "/playback", label: "Yozuvlar", show: can("playback.view"), active: route.path.startsWith("/playback") },
    { to: adminTabs.value[0]?.to || "/", label: "Boshqaruv", show: adminTabs.value.length > 0, active: inAdmin.value },
  ].filter((l) => l.show)
);

// Login sahifasida menyu ko'rinmaydi; "/" — mehmon sahifasi (o'z dizayni bor).
// Statik hosting "/login/" ko'rinishida beradi — oxirgi "/" olib tashlanadi.
const path = computed(() => route.path.replace(/\/+$/, "") || "/");
const onLogin = computed(() => path.value === "/login");
const isGuest = computed(() => path.value === "/");

async function logout() {
  clear();
  await router.push("/login");
}
</script>

<template>
  <div class="app">
    <header v-if="!isGuest" class="topbar">
      <div class="topbar-in">
        <NuxtLink :to="me ? homePath() : '/login'" class="brand">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3z" /><path d="M16 10.5l5-3v9l-5-3" /></svg>
          <span>Kamera tizimi</span>
        </NuxtLink>
        <nav v-if="!onLogin && me" class="nav" aria-label="Asosiy boʻlimlar">
          <NuxtLink v-for="l in links" :key="l.label" :to="l.to" class="nav-link" :class="{ on: l.active }" :aria-current="l.active ? 'page' : undefined">
            {{ l.label }}
          </NuxtLink>
        </nav>
        <div v-if="!onLogin && me" class="user">
          <NuxtLink to="/profile" class="who" title="Profil va parol">{{ me.full_name || me.username }}</NuxtLink>
          <button class="btn logout" @click="logout">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4" /><path d="M6 12h10" /></svg>
            Chiqish
          </button>
        </div>
      </div>
    </header>

    <main class="main" :class="{ 'main-full': isGuest }">
      <nav v-if="inAdmin && me && adminTabs.length" class="tabs" aria-label="Boshqaruv boʻlimlari">
        <NuxtLink v-for="t in adminTabs" :key="t.to" :to="t.to" class="tab" :class="{ on: route.path.startsWith(t.to) || (t.to === '/admin' && /^\/(add|edit)/.test(route.path)) }">
          {{ t.label }}
        </NuxtLink>
      </nav>
      <NuxtPage />
    </main>
  </div>
</template>

<style>
/* =============================================================================
   Umumiy dizayn: yorug' fon, katta harflar, yuqori kontrast.
   Asosiy matn 18px, tugmalar kamida 48px, holatlar doim matn bilan.
   ============================================================================= */
:root {
  --bg: #f4f5f7;
  --panel: #ffffff;
  --panel-2: #f3f4f6;
  --line: #d1d5db;
  --line-strong: #9ca3af;
  --text: #111827;
  --muted: #4b5563;
  --accent: #1d4ed8;
  --accent-ink: #ffffff;
  --accent-dark: #1e3a8a;
  --accent-soft: #eff6ff;
  --accent-soft-line: #bfdbfe;
  --ok: #15803d;
  --ok-soft: #dcfce7;
  --ok-line: #86efac;
  --ok-ink: #14532d;
  --warn: #b45309;
  --warn-soft: #fffbeb;
  --warn-line: #fcd34d;
  --warn-ink: #78350f;
  --danger: #b91c1c;
  --danger-soft: #fef2f2;
  --danger-line: #fca5a5;
  --danger-ink: #7f1d1d;
  --head: #f59e0b;
  --radius: 14px;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 18px;
  line-height: 1.45;
  color-scheme: light;
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
a {
  color: var(--accent);
}
:focus-visible {
  outline: 3px solid #93c5fd;
  outline-offset: 2px;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}
.topbar-in {
  max-width: 1680px;
  margin: 0 auto;
  padding: 12px 28px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 20px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 21px;
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
  margin-right: 8px;
}
.brand svg {
  color: var(--accent);
}
.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
}
.nav-link {
  display: flex;
  align-items: center;
  min-height: 52px;
  padding: 0 20px;
  font-size: 19px;
  font-weight: 600;
  color: #1f2937;
  text-decoration: none;
  border-radius: 10px;
}
.nav-link:hover {
  background: var(--panel-2);
}
.nav-link.on {
  color: var(--accent-ink);
  background: var(--accent);
  font-weight: 700;
}
.user {
  display: flex;
  align-items: center;
  gap: 12px;
}
.who {
  font-size: 17px;
  color: #374151;
  text-decoration: none;
}
.who:hover {
  text-decoration: underline;
}

.main {
  flex: 1;
  width: 100%;
  max-width: 1680px;
  margin: 0 auto;
  padding: 32px 28px 56px;
}
/* Mehmon sahifasi butun ekranni oladi */
.main-full {
  max-width: none;
  padding: 0;
}

/* Boshqaruv ichki yorliqlari */
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  border-bottom: 2px solid var(--line);
  margin-bottom: 28px;
}
.tab {
  display: flex;
  align-items: center;
  min-height: 52px;
  padding: 0 18px;
  font-size: 18px;
  font-weight: 600;
  color: #374151;
  text-decoration: none;
  border-bottom: 4px solid transparent;
  margin-bottom: -2px;
}
.tab:hover {
  color: var(--text);
  background: var(--panel-2);
}
.tab.on {
  color: var(--accent-dark);
  border-bottom-color: var(--accent);
  font-weight: 700;
}

code {
  background: var(--panel-2);
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 15px;
}

/* --- Tugmalar --- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 52px;
  padding: 0 20px;
  border: 2px solid var(--line-strong);
  background: var(--panel);
  color: #1f2937;
  border-radius: 10px;
  font: inherit;
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.btn:hover {
  background: var(--panel-2);
}
.btn:disabled {
  color: #6b7280;
  background: var(--panel-2);
  border-color: #e5e7eb;
  cursor: default;
}
.btn-sm {
  min-height: 46px;
  padding: 0 14px;
  font-size: 17px;
}
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
  font-weight: 700;
}
.btn-primary:hover {
  background: var(--accent-dark);
  border-color: var(--accent-dark);
}
.btn-primary:disabled {
  background: #93c5fd;
  border-color: #93c5fd;
  color: #ffffff;
}
.btn-soft {
  background: var(--accent-soft);
  border-color: var(--accent-soft-line);
  color: var(--accent-dark);
}
.btn-soft:hover {
  background: #dbeafe;
}
.btn-danger {
  color: var(--danger-ink);
  border-color: var(--danger-line);
}
.btn-danger:hover {
  background: var(--danger-soft);
}
.btn-ok {
  background: var(--ok);
  border-color: var(--ok);
  color: #ffffff;
  font-weight: 700;
}

/* --- Maydonlar --- */
.input {
  width: 100%;
  min-height: 52px;
  background: var(--panel);
  border: 2px solid var(--line-strong);
  color: var(--text);
  padding: 8px 14px;
  border-radius: 10px;
  font: inherit;
  font-size: 18px;
}
textarea.input {
  min-height: 96px;
}
.input:focus {
  outline: 3px solid #93c5fd;
  outline-offset: 1px;
  border-color: var(--accent);
}
.input::placeholder {
  color: #6b7280;
}
.label {
  display: block;
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 8px;
}

/* --- Jadval --- */
.table {
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  font-size: 17px;
}
.table th,
.table td {
  text-align: left;
  padding: 14px 16px;
  border-bottom: 1px solid #e5e7eb;
  vertical-align: middle;
}
.table th {
  color: #374151;
  font-weight: 700;
  font-size: 16px;
  background: #f9fafb;
  border-bottom: 2px solid var(--line);
}
.table tr:last-child td {
  border-bottom: none;
}
.table-wrap {
  overflow-x: auto;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.check {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  font-size: 17px;
  cursor: pointer;
}
.check input {
  width: 22px;
  height: 22px;
  flex: none;
  accent-color: var(--accent);
}
.checks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 4px 12px;
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  background: var(--panel);
  border: 2px solid var(--line);
  border-radius: 10px;
}

/* --- Sahifa sarlavhasi, panel --- */
.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.page-head h1 {
  margin: 0;
  font-size: 36px;
  line-height: 1.15;
}
.page-head .sub {
  margin: 8px 0 0;
  color: #374151;
  font-size: 19px;
}
.panel {
  display: grid;
  gap: 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 22px;
  margin-bottom: 22px;
}
.panel h2 {
  margin: 0;
  font-size: 26px;
}
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 700px) {
  .row2 {
    grid-template-columns: 1fr;
  }
  .main {
    padding: 20px 16px 40px;
  }
  .topbar-in {
    padding: 10px 16px;
  }
  .page-head h1 {
    font-size: 30px;
  }
}
.muted {
  color: var(--muted);
}
.err {
  color: var(--danger-ink);
  background: var(--danger-soft);
  border: 2px solid var(--danger-line);
  border-radius: 10px;
  padding: 12px 14px;
  margin: 0;
}
.ok-text {
  color: var(--ok-ink);
  background: var(--ok-soft);
  border: 2px solid var(--ok-line);
  border-radius: 10px;
  padding: 12px 14px;
  margin: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}
.hint {
  color: var(--muted);
  font-size: 16px;
  margin: 6px 0 0;
}
.small {
  font-size: 15px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/* --- Holat belgilari (doim matn bilan) --- */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
  border: 1px solid transparent;
  white-space: nowrap;
}
.badge-ok {
  color: var(--ok-ink);
  background: var(--ok-soft);
}
.badge-warn {
  color: var(--warn-ink);
  background: #fef3c7;
}
.badge-danger {
  color: var(--danger-ink);
  background: #fee2e2;
}
.badge-muted {
  color: #374151;
  background: var(--panel-2);
  border-color: var(--line);
}
.badge-live {
  color: #ffffff;
  background: var(--danger);
}
</style>
