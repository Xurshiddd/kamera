// Brauzer-tomon session: service'dan olingan JWT tokenni localStorage'da
// saqlaymiz. Server (SSR) yo'q, shuning uchun butun login holati klientda.
const STORAGE_KEY = "admin_token";

export function useAuth() {
  const token = useState<string | null>("admin_token", () =>
    import.meta.client ? localStorage.getItem(STORAGE_KEY) : null
  );

  function set(value: string) {
    token.value = value;
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, value);
  }

  function clear() {
    token.value = null;
    if (import.meta.client) localStorage.removeItem(STORAGE_KEY);
  }

  return { token, set, clear };
}
