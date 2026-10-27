// 아주 작은 HTML 템플릿 도구: 값은 자동으로 이스케이프, html`` 결과끼리는 그대로 이어 붙여요.
const RAW = Symbol('raw');

export function raw(s) {
  return { [RAW]: true, s: String(s ?? '') };
}

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  if (typeof v === 'object' && v[RAW]) return v.s;
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return raw(out);
}

export function mount(el, view) {
  el.innerHTML = part(view);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// 이벤트 위임: 다시 그려도 핸들러가 살아 있어요
export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) handler(e, t);
  });
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

// http(s) 주소만 링크로 써요
export function safeUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

let toastTimer;
export function toast(message, isError = false) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), isError ? 6000 : 3200);
}

export function errorText(e) {
  return e?.message || e?.error_description || String(e);
}
