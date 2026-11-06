// Har bir sahifaga o'tishdan oldin ishlaydi (faqat klientda — SSR yo'q).
// "/" (mehmon jonli sahifa) va "/login" OCHIQ; qolganlari token talab qiladi.
// Sahifa `definePageMeta({ permission: "kod" })` bilan ruxsat talab qilsa,
// foydalanuvchida u bo'lmasa — o'zining "uy" sahifasiga yo'naltiriladi.
// (Bu faqat UI qulayligi; haqiqiy himoya service'da.)
const PUBLIC_PATHS = ["/", "/login"];

export default defineNuxtRouteMiddleware(async (to) => {
  if (PUBLIC_PATHS.includes(to.path)) return;

  const { token, loadMe, can, homePath } = useAuth();
  const toLogin = () =>
    navigateTo({ path: "/login", query: { redirect: to.fullPath } });

  if (!token.value) return toLogin();
  const me = await loadMe();
  if (!me) return toLogin();

  const perm = to.meta.permission as string | string[] | undefined;
  if (!perm) return;
  const perms = Array.isArray(perm) ? perm : [perm];
  if (!perms.some(can)) {
    const home = homePath();
    if (home !== to.path) return navigateTo(home);
  }
});
