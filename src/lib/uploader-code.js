// 업로드 프로그램 "설정 코드": 설정 파일 대신 붙여 넣는 한 줄 (public/uploader/mumei-uploader.cjs 의 parseConfigCode 가 읽어요)
// mumei: + base64url(JSON { endpoint, deviceKey, folder })

export const CODE_PREFIX = 'mumei:';

export function makeConfigCode({ endpoint, deviceKey, folder = '' }) {
  const bytes = new TextEncoder().encode(JSON.stringify({ endpoint, deviceKey, folder: folder || '' }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return CODE_PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
