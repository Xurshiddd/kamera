import { u as useRouter, _ as __nuxt_component_0 } from './server.mjs';
import { defineComponent, reactive, ref, mergeProps, unref, withCtx, createTextVNode, useSSRContext } from 'vue';
import { ssrRenderAttrs, ssrRenderAttr, ssrRenderStyle, ssrIncludeBooleanAttr, ssrLooseContain, ssrLooseEqual, ssrInterpolate, ssrRenderComponent } from 'vue/server-renderer';
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
  __name: "add",
  __ssrInlineRender: true,
  setup(__props) {
    useRouter();
    const form = reactive({
      name: "",
      ip: "",
      port: 554,
      login: "",
      parol: "",
      rtspPath: ""
    });
    const brand = ref("hikvision");
    const rtspByBrand = {
      hikvision: "Streaming/Channels/101",
      dahua: "cam/realmonitor?channel=1&subtype=0",
      custom: ""
    };
    const saving = ref(false);
    const error = ref("");
    return (_ctx, _push, _parent, _attrs) => {
      const _component_NuxtLink = __nuxt_component_0;
      _push(`<section${ssrRenderAttrs(mergeProps({ class: "wrap" }, _attrs))} data-v-3070c4ec><h1 data-v-3070c4ec>Yangi kamera</h1><p class="muted" data-v-3070c4ec> Login va parol faqat serverda saqlanadi \u2014 tashqi URL&#39;da ko&#39;rinmaydi. </p><div class="form" data-v-3070c4ec><div data-v-3070c4ec><label class="label" data-v-3070c4ec>Nom</label><input${ssrRenderAttr("value", unref(form).name)} class="input" placeholder="Masalan: 1-qavat dahliz" data-v-3070c4ec></div><div class="row" data-v-3070c4ec><div style="${ssrRenderStyle({ "flex": "2" })}" data-v-3070c4ec><label class="label" data-v-3070c4ec>Kamera IP</label><input${ssrRenderAttr("value", unref(form).ip)} class="input" placeholder="192.168.1.64" data-v-3070c4ec></div><div style="${ssrRenderStyle({ "flex": "1" })}" data-v-3070c4ec><label class="label" data-v-3070c4ec>Port</label><input${ssrRenderAttr("value", unref(form).port)} class="input" type="number" data-v-3070c4ec></div></div><div class="row" data-v-3070c4ec><div style="${ssrRenderStyle({ "flex": "1" })}" data-v-3070c4ec><label class="label" data-v-3070c4ec>Login</label><input${ssrRenderAttr("value", unref(form).login)} class="input" placeholder="admin" data-v-3070c4ec></div><div style="${ssrRenderStyle({ "flex": "1" })}" data-v-3070c4ec><label class="label" data-v-3070c4ec>Parol</label><input${ssrRenderAttr("value", unref(form).parol)} class="input" type="password" data-v-3070c4ec></div></div><div data-v-3070c4ec><label class="label" data-v-3070c4ec>Kamera brendi</label><select class="input" data-v-3070c4ec><option value="hikvision" data-v-3070c4ec${ssrIncludeBooleanAttr(Array.isArray(unref(brand)) ? ssrLooseContain(unref(brand), "hikvision") : ssrLooseEqual(unref(brand), "hikvision")) ? " selected" : ""}>Hikvision</option><option value="dahua" data-v-3070c4ec${ssrIncludeBooleanAttr(Array.isArray(unref(brand)) ? ssrLooseContain(unref(brand), "dahua") : ssrLooseEqual(unref(brand), "dahua")) ? " selected" : ""}>Dahua</option><option value="custom" data-v-3070c4ec${ssrIncludeBooleanAttr(Array.isArray(unref(brand)) ? ssrLooseContain(unref(brand), "custom") : ssrLooseEqual(unref(brand), "custom")) ? " selected" : ""}>Boshqa (qo&#39;lda)</option></select></div>`);
      if (unref(brand) === "custom") {
        _push(`<div data-v-3070c4ec><label class="label" data-v-3070c4ec>RTSP yo&#39;li</label><input${ssrRenderAttr("value", unref(form).rtspPath)} class="input mono" placeholder="Streaming/Channels/101" data-v-3070c4ec></div>`);
      } else {
        _push(`<p class="hint mono" data-v-3070c4ec>RTSP yo&#39;li: ${ssrInterpolate(rtspByBrand[unref(brand)])}</p>`);
      }
      if (unref(error)) {
        _push(`<p class="err" data-v-3070c4ec>${ssrInterpolate(unref(error))}</p>`);
      } else {
        _push(`<!---->`);
      }
      _push(`<div class="actions" data-v-3070c4ec>`);
      _push(ssrRenderComponent(_component_NuxtLink, {
        to: "/",
        class: "btn"
      }, {
        default: withCtx((_, _push2, _parent2, _scopeId) => {
          if (_push2) {
            _push2(`Bekor qilish`);
          } else {
            return [
              createTextVNode("Bekor qilish")
            ];
          }
        }),
        _: 1
      }, _parent));
      _push(`<button class="btn btn-primary"${ssrIncludeBooleanAttr(unref(saving)) ? " disabled" : ""} data-v-3070c4ec>${ssrInterpolate(unref(saving) ? "Saqlanmoqda\u2026" : "Qo'shish")}</button></div></div></section>`);
    };
  }
});
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("pages/add.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const add = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-3070c4ec"]]);

export { add as default };
//# sourceMappingURL=add-B6QacZTQ.mjs.map
