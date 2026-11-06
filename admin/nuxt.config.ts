export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: false },

  // Toza static (SPA) — gateway nginx statik beradi (Docker'da quriladi).
  // `nuxi generate` HTML/JS/CSS chiqaradi, server route'lar bo'lmaydi.
  ssr: false,

  // Nuxt 3.21.x da SPA (ssr:false) dev serverida "No entry found in
  // rollupOptions.input" bug'ini chetlab o'tish uchun Vite Environment API.
  experimental: {
    viteEnvironmentApi: true,
  },

  // Domen ildizidan beriladi (cam.ttysi.uz -> gateway -> /).
  app: {
    baseURL: "/",
  },

  // To'g'ridan-to'g'ri yo'naltirilgan sahifalar uchun HTML shellar yaratamiz,
  // shunda /admin/login ga to'g'ridan kirilganda ham ishlaydi.
  nitro: {
    prerender: {
      routes: [
        "/", "/login", "/add", "/status", "/admin", "/live", "/users",
        "/roles", "/groups", "/audit", "/profile", "/no-access", "/nvrs", "/playback",
      ],
    },
  },

  runtimeConfig: {
    public: {
      // Boshqa serverdagi service manzili (LAN IP yoki domen).
      // Masalan: http://192.168.1.50:4000
      serviceBase: "", // -> NUXT_PUBLIC_SERVICE_BASE
    },
  },
});
