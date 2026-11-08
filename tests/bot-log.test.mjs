// 디스코드 봇 로그: 인터넷 끊김 안내 · HTML 오류 페이지 줄이기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactArg, compactText, dbHint, isNetworkError, summarizeHtml } from '../bot/src/errors.js';

// Cloudflare 오류 페이지 모양 (실제 페이지를 줄인 예시)
const CF_PAGE = `<!DOCTYPE html>
<html lang="en-US"><head><title>DNS resolution error | example.supabase.co | Cloudflare</title>
<style>body { color: red }</style></head>
<body><div id="cf-wrapper"><h1><span class="cf-error-type">Error</span> <span class="cf-error-code">1001</span></h1>
<p>Please see <a href="https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1001/">this</a></p>
<span class="cf-footer-item">Cloudflare Ray ID: <strong class="font-semibold">0123456789abcdef</strong></span>
<script>(function(){ var a = document; })();</script>
</div></body></html>`;

test('supabase 의 fetch 실패 · 이름 찾기 실패는 인터넷 끊김으로 봐요', () => {
  assert.equal(isNetworkError({ message: 'TypeError: fetch failed', details: '', code: '' }), true);
  assert.equal(isNetworkError({ message: 'TypeError: fetch failed', details: 'Caused by: Error: getaddrinfo EAI_AGAIN example.supabase.co' }), true);
  assert.equal(isNetworkError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })), true);
  assert.equal(isNetworkError(Object.assign(new Error('x'), { code: 'ECONNRESET' })), true);
  assert.equal(isNetworkError({ message: 'new row violates row-level security policy' }), false);
  assert.equal(isNetworkError(null), false);
});

test('신호 실패 안내: 인터넷이면 SQL 대신 인터넷 확인', () => {
  assert.match(dbHint({ message: 'TypeError: fetch failed' }), /인터넷/);
  assert.doesNotMatch(dbHint({ message: 'TypeError: fetch failed' }), /SQL/);
  assert.match(dbHint({ message: 'new row violates row-level security policy for table "bot_status"' }), /비밀 키/);
  assert.match(dbHint({ code: '42P01', message: 'relation "public.bot_status" does not exist' }), /6단계 SQL/);
  assert.match(dbHint({ code: 'PGRST205', message: "Could not find the table 'public.bot_status' in the schema cache" }), /6단계 SQL/);
  assert.match(dbHint({ message: 'Invalid API key' }), /SUPABASE_SECRET_KEY/);
  assert.match(dbHint({ message: '알 수 없는 오류' }), /status\.supabase\.com/);
  assert.equal(dbHint({ message: '알 수 없는 오류' }, '기본 안내'), '기본 안내');
});

test('Cloudflare 오류 페이지는 한 줄로 줄여요 (오류 번호 · 제목 · Ray ID)', () => {
  const s = summarizeHtml(CF_PAGE);
  assert.match(s, /Cloudflare 오류 1001/);
  assert.match(s, /DNS resolution error/);
  assert.match(s, /Ray ID 0123456789abcdef/);
  assert.doesNotMatch(s, /<|function/);
});

test('로그 글 안의 HTML 만 바꾸고 앞뒤 글은 남겨요', () => {
  const out = compactText(`[갱신] ${CF_PAGE}\n뒤에 붙은 글`);
  assert.ok(out.startsWith('[갱신] [Cloudflare 오류 1001'));
  assert.ok(out.endsWith('뒤에 붙은 글'));
  assert.ok(!out.includes('<html'));
  assert.ok(out.split('\n').length <= 2);
});

test('닫는 태그가 없는(잘린) HTML 도 줄여요', () => {
  const out = compactText(`앞 ${CF_PAGE.slice(0, 300)}`);
  assert.match(out, /^앞 \[Cloudflare 오류/);
  assert.ok(!out.includes('<head'));
});

test('보통 글 · 숫자 · 객체는 그대로, 아주 긴 글은 잘라요', () => {
  assert.equal(compactArg('무명섬 봇 켜짐'), '무명섬 봇 켜짐');
  assert.equal(compactArg(3), 3);
  const obj = { a: 1 };
  assert.equal(compactArg(obj), obj);
  const long = compactArg('가'.repeat(5000));
  assert.ok(long.length < 1600);
  assert.match(long, /3500자 줄임/);
});

test('오류(Error) 안에 HTML 이 들어 있어도 줄여요', () => {
  const out = compactArg(new Error(CF_PAGE));
  assert.match(out, /^Error: \[Cloudflare 오류 1001/);
  assert.ok(!out.includes('<script'));
});
