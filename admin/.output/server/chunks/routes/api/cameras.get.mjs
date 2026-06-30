import { c as defineEventHandler } from '../../_/nitro.mjs';
import { s as serviceFetch } from '../../_/service.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const cameras_get = defineEventHandler(() => serviceFetch("/api/cameras"));

export { cameras_get as default };
//# sourceMappingURL=cameras.get.mjs.map
