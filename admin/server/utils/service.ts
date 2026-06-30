// Serverda (Nitro) ishlaydi — API kalitni shu yerda qo'shamiz,
// shuning uchun kalit brauzerga hech qachon chiqmaydi.
export function serviceFetch(path: string, opts: any = {}) {
  const cfg = useRuntimeConfig();
  return $fetch(`${cfg.public.serviceBase}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), "x-api-key": cfg.serviceApiKey },
  });
}
