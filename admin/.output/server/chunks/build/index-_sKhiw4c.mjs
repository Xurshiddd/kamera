import { _ as __nuxt_component_0 } from './server.mjs';
import { defineComponent, ref, withCtx, createTextVNode, unref, shallowRef, getCurrentInstance, provide, cloneVNode, h, createElementBlock, useSSRContext } from 'vue';
import { ssrRenderAttrs, ssrRenderComponent, ssrInterpolate, ssrRenderList, ssrRenderAttr } from 'vue/server-renderer';
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

defineComponent({
  name: "ServerPlaceholder",
  render() {
    return createElementBlock("div");
  }
});
const clientOnlySymbol = /* @__PURE__ */ Symbol.for("nuxt:client-only");
const __nuxt_component_1 = defineComponent({
  name: "ClientOnly",
  inheritAttrs: false,
  props: ["fallback", "placeholder", "placeholderTag", "fallbackTag"],
  ...false,
  setup(props, { slots, attrs }) {
    const mounted = shallowRef(false);
    const vm = getCurrentInstance();
    if (vm) {
      vm._nuxtClientOnly = true;
    }
    provide(clientOnlySymbol, true);
    return () => {
      var _a;
      if (mounted.value) {
        const vnodes = (_a = slots.default) == null ? void 0 : _a.call(slots);
        if (vnodes && vnodes.length === 1) {
          return [cloneVNode(vnodes[0], attrs)];
        }
        return vnodes;
      }
      const slot = slots.fallback || slots.placeholder;
      if (slot) {
        return h(slot);
      }
      const fallbackStr = props.fallback || props.placeholder || "";
      const fallbackTag = props.fallbackTag || props.placeholderTag || "span";
      return createElementBlock(fallbackTag, attrs, fallbackStr);
    };
  }
});
const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "index",
  __ssrInlineRender: true,
  setup(__props) {
    const cameras = ref([]);
    const loading = ref(true);
    const error = ref("");
    ref(null);
    return (_ctx, _push, _parent, _attrs) => {
      const _component_NuxtLink = __nuxt_component_0;
      const _component_ClientOnly = __nuxt_component_1;
      _push(`<section${ssrRenderAttrs(_attrs)} data-v-abbe5b94><div class="head" data-v-abbe5b94><h1 data-v-abbe5b94>Kameralar</h1>`);
      _push(ssrRenderComponent(_component_NuxtLink, {
        to: "/add",
        class: "btn btn-primary"
      }, {
        default: withCtx((_, _push2, _parent2, _scopeId) => {
          if (_push2) {
            _push2(`+ Kamera qo&#39;shish`);
          } else {
            return [
              createTextVNode("+ Kamera qo'shish")
            ];
          }
        }),
        _: 1
      }, _parent));
      _push(`</div>`);
      if (unref(loading)) {
        _push(`<p class="muted" data-v-abbe5b94>Yuklanmoqda\u2026</p>`);
      } else if (unref(error)) {
        _push(`<p class="err" data-v-abbe5b94>${ssrInterpolate(unref(error))}</p>`);
      } else if (!unref(cameras).length) {
        _push(`<p class="muted" data-v-abbe5b94> Hali kamera yo&#39;q. Yuqoridagi tugma orqali birinchisini qo&#39;shing. </p>`);
      } else {
        _push(`<div class="grid" data-v-abbe5b94><!--[-->`);
        ssrRenderList(unref(cameras), (c) => {
          _push(`<article class="card" data-v-abbe5b94><div class="card-head" data-v-abbe5b94><div data-v-abbe5b94><h3 data-v-abbe5b94>${ssrInterpolate(c.name)}</h3><span class="slug" data-v-abbe5b94>${ssrInterpolate(c.slug)}</span></div><button class="btn btn-danger" data-v-abbe5b94>O&#39;chirish</button></div>`);
          _push(ssrRenderComponent(_component_ClientOnly, null, {}, _parent));
          _push(`<div class="urls" data-v-abbe5b94><div class="url-row" data-v-abbe5b94><span class="tag" data-v-abbe5b94>HLS</span><input class="input mono"${ssrRenderAttr("value", c.hls)} readonly data-v-abbe5b94><button class="btn" data-v-abbe5b94>Nusxa</button></div><div class="url-row" data-v-abbe5b94><span class="tag" data-v-abbe5b94>Embed</span><input class="input mono"${ssrRenderAttr("value", c.embed)} readonly data-v-abbe5b94><button class="btn" data-v-abbe5b94>Nusxa</button></div></div></article>`);
        });
        _push(`<!--]--></div>`);
      }
      _push(`</section>`);
    };
  }
});
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("pages/index.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-abbe5b94"]]);

export { index as default };
//# sourceMappingURL=index-_sKhiw4c.mjs.map
