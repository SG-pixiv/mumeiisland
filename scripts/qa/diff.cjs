// 두 스냅샷 비교: node scripts/qa/diff.cjs before after
const fs = require('fs');
// 이름만 주면 scripts/qa/<이름>.json
const file = (f) => (/[\\/]/.test(f) ? f : require('path').join(__dirname, f.endsWith('.json') ? f : f + '.json'));
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(file(f), 'utf8')));
// 실행할 때마다 바뀌는 시각(예시 데이터의 "마지막 확인" 등)은 빼고 비교해요
const norm = (t) => t.replace(/(확인|신호) \d{1,2}\/\d{1,2} \d{2}:\d{2}/g, '$1 <시각>');
for (const s of [a, b]) for (const k of Object.keys(s)) s[k].text = norm(s[k].text);
let bad = 0;
for (const path of Object.keys(a)) {
  const x = a[path], y = b[path];
  if (!y) { console.log('없음', path); bad++; continue; }
  const problems = [];
  if (x.text !== y.text) {
    const xl = x.text.split('\n'), yl = y.text.split('\n');
    const i = xl.findIndex((l, k) => l !== yl[k]);
    problems.push(`글자 다름 @${i}: "${(xl[i] || '').slice(0, 90)}" → "${(yl[i] || '').slice(0, 90)}"`);
  }
  if (x.elements !== y.elements) problems.push(`요소 수 ${x.elements} → ${y.elements}`);
  if (y.errors.length) problems.push('오류: ' + y.errors.join(' | ').slice(0, 300));
  if (y.poll && !y.poll.textSame) problems.push('10초 갱신 뒤 글자가 바뀜');
  if (problems.length) { bad++; console.log('✗', path, '\n   ' + problems.join('\n   ')); }
}
console.log(bad ? `\n다른 페이지 ${bad}개` : '\n모든 페이지가 같아요');
