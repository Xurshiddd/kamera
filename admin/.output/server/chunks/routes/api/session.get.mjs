import { c as defineEventHandler, v as verifySession, k as getCookie, S as SESSION_COOKIE } from '../../_/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const session_get = defineEventHandler((event) => {
  return { authed: verifySession(getCookie(event, SESSION_COOKIE)) };
});

export { session_get as default };
//# sourceMappingURL=session.get.mjs.map
