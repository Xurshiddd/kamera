export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: false },

  runtimeConfig: {
    // Faqat serverda ko'rinadi (brauzerga chiqmaydi):
    serviceApiKey: "", // -> NUXT_SERVICE_API_KEY

    // Panelga kirish paroli (login sahifasi shuni tekshiradi):
    adminPassword: "", // -> NUXT_ADMIN_PASSWORD
    // Session cookie'ni imzolash uchun maxfiy kalit:
    sessionSecret: "", // -> NUXT_SESSION_SECRET

    public: {
      // Serverdagi service manzili. Masalan: http://192.168.1.50:4000
      // yoki Cloudflare Tunnel domeni.
      serviceBase: "", // -> NUXT_PUBLIC_SERVICE_BASE
    },
  },
});
