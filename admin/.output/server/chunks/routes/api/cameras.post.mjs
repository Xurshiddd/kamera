import { c as defineEventHandler, r as readBody } from '../../_/nitro.mjs';
import { s as serviceFetch } from '../../_/service.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const cameras_post = defineEventHandler(async (event) => {
  const body = await readBody(event);
  return serviceFetch("/api/cameras", { method: "POST", body });
});

export { cameras_post as default };
//# sourceMappingURL=cameras.post.mjs.map
