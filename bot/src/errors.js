// 봇 로그를 읽기 쉽게: 인터넷 끊김 알아보기 · 오류 페이지(HTML)를 한 줄로 줄이기

const NETWORK = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|UND_ERR|socket hang up|network ?error|getaddrinfo/i;
const HTML_START = /<!doctype html|<html[\s>]/i;
const MAX_LEN = 1500;

const textOf = (e) => (typeof e === 'string' ? e : e?.message ?? String(e ?? ''));

/** 서버 인터넷이 끊겨서 생긴 오류인지 (fetch 실패 · 이름 찾기 실패 · 연결 끊김 등) */
export function isNetworkError(e) {
  const codes = [e?.code, e?.cause?.code, e?.cause?.cause?.code].filter(Boolean).join(' ');
  return NETWORK.test(`${textOf(e)} ${codes} ${e?.details ?? ''}`);
}

/** 테이블이 없다는 오류인지 (SQL 단계를 안 했을 때) */
export function isMissingTable(e) {
  return e?.code === '42P01' || e?.code === 'PGRST205' || /does not exist|could not find the table/i.test(textOf(e));
}

/** Supabase 요청이 실패했을 때 무엇을 확인하면 되는지 */
export function dbHint(e, fallback = 'Supabase 상태(https://status.supabase.com)를 확인해 주세요') {
  const msg = textOf(e);
  if (/row-level security/i.test(msg)) return 'SUPABASE_SECRET_KEY 가 비밀 키(sb_secret_...)가 아니에요. 지금 키로는 참가 신청 · 투표가 막혀요';
  if (isNetworkError(e)) return '서버가 인터넷(Supabase)에 연결하지 못했어요. 서버 인터넷이나 WARP · VPN 같은 프로그램을 확인해 주세요 (잠깐 끊긴 거면 저절로 돌아와요)';
  if (isMissingTable(e)) return '6단계 SQL 을 실행했는지 확인해 주세요';
  if (/invalid api key|jwt|unauthorized/i.test(msg)) return 'SUPABASE_SECRET_KEY 를 확인해 주세요';
  return fallback;
}

/** HTML 오류 페이지 →"Cloudflare 오류 1001 · 제목 (Ray ID …)" 한 줄 */
export function summarizeHtml(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
  const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const code = text.match(/Error(?: code)?:?\s*(\d{3,4})\b/i)?.[1] ?? html.match(/error[-_](\d{4})\b/i)?.[1];
  const ray = text.match(/Ray ID:?\s*([0-9a-f]{12,20})/i)?.[1];
  const cloudflare = /cloudflare/i.test(html);
  const parts = [
    cloudflare ? `Cloudflare 오류${code ? ` ${code}` : ''}` : `웹 오류 페이지${code ? ` ${code}` : ''}`,
    title,
    ray ? `Ray ID ${ray}` : ''
  ].filter(Boolean);
  return `[${parts.join(' · ')}] (HTML 오류 페이지라 줄였어요)`;
}

/** 로그 한 조각: HTML 은 한 줄로, 너무 긴 글은 잘라요 */
export function compactText(s) {
  let text = String(s);
  const at = text.search(HTML_START);
  if (at >= 0) {
    const end = text.search(/<\/html>/i);
    const stop = end >= 0 ? end + '</html>'.length : text.length;
    text = text.slice(0, at) + summarizeHtml(text.slice(at, stop)) + text.slice(stop);
  }
  return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN)} …(${text.length - MAX_LEN}자 줄임)` : text;
}

/** console.log 에 넘길 값: 글자 · 오류는 줄이고, 나머지는 그대로 */
export function compactArg(a) {
  if (typeof a === 'string') return compactText(a);
  if (a instanceof Error) return compactText(a.stack ?? `${a.name}: ${a.message}`);
  return a;
}
