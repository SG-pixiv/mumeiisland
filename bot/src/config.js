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
  }
  return cfg;
}
