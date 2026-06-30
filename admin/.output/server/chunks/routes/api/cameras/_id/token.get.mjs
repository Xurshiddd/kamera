import { c as defineEventHandler, g as getRouterParam } from '../../../../_/nitro.mjs';
import { s as serviceFetch } from '../../../../_/service.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const token_get = defineEventHandler((event) => {
  const slug = getRouterParam(event, "id");
  return serviceFetch(`/api/cameras/${slug}/token`);
});

export { token_get as default };
//# sourceMappingURL=token.get.mjs.map
