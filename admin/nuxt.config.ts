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
    head: {
      htmlAttrs: { lang: "uz" },
      title: "Kamera tizimi",
      link: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
        { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
      ],
    },
  },

  // To'g'ridan-to'g'ri yo'naltirilgan sahifalar uchun HTML shellar yaratamiz,
  // shunda /admin/login ga to'g'ridan kirilganda ham ishlaydi.
  nitro: {
    prerender: {
      routes: [
        "/", "/login", "/add", "/status", "/admin", "/live", "/users",
        "/roles", "/groups", "/audit", "/profile", "/no-access", "/nvrs", "/playback", "/nvr-cameras",
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
