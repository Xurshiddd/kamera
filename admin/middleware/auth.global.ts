// Har bir sahifaga o'tishdan oldin ishlaydi.
// Kirilmagan bo'lsa /login ga yo'naltiradi.
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === "/login") return;

  try {
    const { authed } = await $fetch<{ authed: boolean }>("/api/session", {
      // SSR paytida brauzer cookie'sini server route'ga uzatamiz.
      headers: import.meta.server ? useRequestHeaders(["cookie"]) : undefined,
    });
    if (!authed) return navigateTo("/login");
  } catch {
    return navigateTo("/login");
  }
});
