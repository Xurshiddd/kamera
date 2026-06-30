import { c as defineEventHandler, g as getRouterParam } from '../../../_/nitro.mjs';
import { s as serviceFetch } from '../../../_/service.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const _id__delete = defineEventHandler((event) => {
  const id = getRouterParam(event, "id");
  return serviceFetch(`/api/cameras/${id}`, { method: "DELETE" });
});

export { _id__delete as default };
//# sourceMappingURL=_id_.delete.mjs.map
