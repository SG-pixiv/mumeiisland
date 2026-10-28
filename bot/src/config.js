// 설정: bot/.env 에서 읽어요 (.env.example 참고). 비밀 값은 절대 깃허브에 올리지 마세요.

function need(name) {
  const v = (process.env[name] ?? '').trim();
  if (!v) {
    console.error(`[설정] ${name} 이(가) 비어 있어요. bot/.env 를 확인해 주세요.`);
    process.exit(1);
  }
  return v;
}

export function loadConfig({ forRegister = false } = {}) {
  const cfg = {
    token: need('DISCORD_TOKEN'),
    appId: need('DISCORD_APP_ID'),
    guildId: need('DISCORD_GUILD_ID'),
    siteUrl: (process.env.SITE_URL || 'https://mumeiisland.vercel.app').replace(/\/+$/, '')
  };
  if (!forRegister) {
    cfg.supabaseUrl = need('SUPABASE_URL').replace(/\/+$/, '');
    cfg.supabaseKey = need('SUPABASE_SECRET_KEY');
    cfg.refreshMinutes = Math.max(1, Number(process.env.REFRESH_MINUTES || 3));
    const why = keyProblem(cfg.supabaseKey);
    if (why) {
      console.error(`[설정] SUPABASE_SECRET_KEY: ${why}`);
      console.error('       Supabase → Project Settings → API Keys → 아래쪽 "Secret keys" 의 sb_secret_... 키를 넣어 주세요.');
      process.exit(1);
    }
  }
  return cfg;
}

/** 비밀 키(service_role)인지: 공개 키를 넣으면 읽기만 되고 참가 신청 · 투표 · 관리자 키가 전부 막혀요 */
export function keyProblem(key) {
  const k = String(key).trim();
  if (k.startsWith('sb_secret_')) return '';
  if (k.startsWith('sb_publishable_')) return '공개 키(Publishable key)를 넣었어요. 비밀 키가 필요해요.';
  const parts = k.split('.');
  if (parts.length === 3) {   // 예전 방식 JWT 키: role 이 service_role 이어야 해요
    try {
      const role = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role;
      if (role === 'service_role') return '';
      if (role === 'anon') return '예전 방식의 anon(공개) 키를 넣었어요. service_role 키나 sb_secret_ 키가 필요해요.';
    } catch { /* 모르는 모양이면 아래로 */ }
  }
  return '';   // 모르는 모양은 일단 믿고 켜요 (켜진 뒤 DB 쓰기 확인에서 걸러져요)
}
