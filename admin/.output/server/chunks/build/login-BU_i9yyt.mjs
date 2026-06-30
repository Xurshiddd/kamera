import { defineComponent, ref, mergeProps, unref, useSSRContext } from 'vue';
import { ssrRenderAttrs, ssrRenderAttr, ssrInterpolate, ssrIncludeBooleanAttr } from 'vue/server-renderer';
import { u as useRouter, a as useRoute } from './server.mjs';
import { _ as _export_sfc } from './_plugin-vue_export-helper-1tPrXgE0.mjs';
import '../_/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '../routes/renderer.mjs';
import 'vue-bundle-renderer/runtime';
import 'unhead/server';
import 'devalue';
import 'unhead/utils';
import 'unhead/plugins';
import 'vue-router';

const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "login",
  __ssrInlineRender: true,
  setup(__props) {
    const password = ref("");
    const error = ref("");
    const loading = ref(false);
    useRouter();
    useRoute();
    return (_ctx, _push, _parent, _attrs) => {
      _push(`<section${ssrRenderAttrs(mergeProps({ class: "login-wrap" }, _attrs))} data-v-f2d9912e><form class="card" data-v-f2d9912e><div class="logo" data-v-f2d9912e><span class="dot" data-v-f2d9912e></span> Kamera boshqaruvi </div><p class="muted" data-v-f2d9912e>Davom etish uchun parolni kiriting.</p><div data-v-f2d9912e><label class="label" data-v-f2d9912e>Parol</label><input${ssrRenderAttr("value", unref(password))} class="input" type="password" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" autofocus data-v-f2d9912e></div>`);
      if (unref(error)) {
        _push(`<p class="err" data-v-f2d9912e>${ssrInterpolate(unref(error))}</p>`);
      } else {
        _push(`<!---->`);
      }
      _push(`<button class="btn btn-primary"${ssrIncludeBooleanAttr(unref(loading)) ? " disabled" : ""} type="submit" data-v-f2d9912e>${ssrInterpolate(unref(loading) ? "Tekshirilmoqda\u2026" : "Kirish")}</button></form></section>`);
    };
  }
});
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("pages/login.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const login = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-f2d9912e"]]);

export { login as default };
//# sourceMappingURL=login-BU_i9yyt.mjs.map
