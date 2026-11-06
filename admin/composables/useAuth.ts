// Brauzer-tomon session: service'dan olingan JWT tokenni localStorage'da
// saqlaymiz. Server (SSR) yo'q, shuning uchun butun login holati klientda.
// `me` — joriy foydalanuvchi va ruxsatlari (menyu/sahifalarni ko'rsatish
// uchun; haqiqiy tekshiruv baribir service'da har API so'rovda).
const STORAGE_KEY = "admin_token";

export interface Me {
  id: number | null;
  username: string;
  full_name: string | null;
  roles: string[];
  permissions: string[];
}

// Ruxsatga qarab "uy" sahifa: login'dan keyin yoki ruxsatsiz sahifaga
// kirilganda shu yerga yo'naltiriladi.
const HOME_ORDER: [string, string][] = [
  ["cameras.manage", "/admin"],
  ["live.view", "/live"],
  ["playback.view", "/playback"],
  ["users.manage", "/users"],
  ["status.view", "/status"],
  ["audit.view", "/audit"],
];

export function useAuth() {
  const token = useState<string | null>("admin_token", () =>
    import.meta.client ? localStorage.getItem(STORAGE_KEY) : null
  );
  const me = useState<Me | null>("me", () => null);

  function set(value: string) {
    token.value = value;
    me.value = null;
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, value);
  }

  function clear() {
    token.value = null;
    me.value = null;
    if (import.meta.client) localStorage.removeItem(STORAGE_KEY);
  }

  // /api/me ni bir marta yuklaydi (force=true — qayta).
  async function loadMe(force = false): Promise<Me | null> {
    if (!token.value) return null;
    if (me.value && !force) return me.value;
    const base = useRuntimeConfig().public.serviceBase as string;
    try {
      me.value = await $fetch<Me>(`${base}/api/me`, {
        headers: { Authorization: `Bearer ${token.value}` },
      });
    } catch (e: any) {
      // Token eskirgan / foydalanuvchi bloklangan -> chiqaramiz.
      if (e?.response?.status === 401) clear();
      me.value = null;
    }
    return me.value;
  }

  const can = (code: string) => Boolean(me.value?.permissions.includes(code));

  function homePath(): string {
    for (const [perm, path] of HOME_ORDER) if (can(perm)) return path;
    return "/no-access";
  }

  return { token, me, set, clear, loadMe, can, homePath };
}
