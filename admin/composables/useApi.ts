// Service'ga to'g'ridan-to'g'ri (boshqa serverdagi IP/domen) so'rov yuboruvchi
// yordamchi. Har so'rovga admin Bearer tokenini qo'shadi. 401 bo'lsa tokenni
// tozalab login sahifasiga qaytaradi.
export function useApi() {
  const base = useRuntimeConfig().public.serviceBase as string;
  const { token, clear } = useAuth();

  async function call<T = any>(path: string, opts: any = {}): Promise<T> {
    try {
      return await $fetch<T>(`${base}${path}`, {
        ...opts,
        headers: {
          ...(opts.headers || {}),
          ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}),
        },
      });
    } catch (e: any) {
      if (e?.response?.status === 401) {
        clear();
        if (import.meta.client) await navigateTo("/login");
      }
      throw e;
    }
  }

  return { call, base };
}
