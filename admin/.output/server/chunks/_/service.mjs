import { u as useRuntimeConfig } from './nitro.mjs';

function serviceFetch(path, opts = {}) {
  const cfg = useRuntimeConfig();
  return $fetch(`${cfg.public.serviceBase}${path}`, {
    ...opts,
    headers: { ...opts.headers || {}, "x-api-key": cfg.serviceApiKey }
  });
}

export { serviceFetch as s };
//# sourceMappingURL=service.mjs.map
