export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: false },

  // Toza static (SPA) — serversiz hosting (Hestia public_html) uchun.
  // `nuxi generate` HTML/JS/CSS chiqaradi, server route'lar bo'lmaydi.
  ssr: false,

  // Sayt domen ostida /admin/ yo'lida turadi. Asset'lar va router shunga moslanadi.
  app: {
    baseURL: "/admin/",
  },

  // To'g'ridan-to'g'ri yo'naltirilgan sahifalar uchun HTML shellar yaratamiz,
  // shunda /admin/login ga to'g'ridan kirilganda ham ishlaydi.
  nitro: {
    prerender: {
      routes: ["/", "/login", "/add"],
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
