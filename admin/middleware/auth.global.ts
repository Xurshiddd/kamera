// Har bir sahifaga o'tishdan oldin ishlaydi (faqat klientda — SSR yo'q).
// "/" (mehmon jonli sahifa) va "/login" OCHIQ; qolgan sahifalar (admin
// boshqaruvi) token talab qiladi. Token haqiqiyligini service'ning o'zi
// (har API so'rovda) tekshiradi; bu yerda faqat tezkor tekshiruv.
const PUBLIC_PATHS = ["/", "/login"];

export default defineNuxtRouteMiddleware((to) => {
  if (PUBLIC_PATHS.includes(to.path)) return;

  const { token } = useAuth();
  if (!token.value) {
    return navigateTo({ path: "/login", query: { redirect: to.fullPath } });
  }
});
