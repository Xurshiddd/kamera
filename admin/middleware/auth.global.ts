// Har bir sahifaga o'tishdan oldin ishlaydi (faqat klientda — SSR yo'q).
// Token bo'lmasa /login ga yo'naltiradi. Token haqiqiyligini service'ning
// o'zi (har API so'rovda) tekshiradi; bu yerda faqat tezkor tekshiruv.
export default defineNuxtRouteMiddleware((to) => {
  if (to.path === "/login") return;

  const { token } = useAuth();
  if (!token.value) {
    return navigateTo({ path: "/login", query: { redirect: to.fullPath } });
  }
});
