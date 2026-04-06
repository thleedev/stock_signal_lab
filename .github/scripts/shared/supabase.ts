import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  throw new Error('SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수 필요');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
