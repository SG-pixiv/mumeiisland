import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 환경변수가 없으면 예시 데이터로 돌아가는 "데모 모드"예요 (배포 전에 화면 확인용)
export const supabase = url && key ? createClient(url, key) : null;
export const isDemo = !supabase;
