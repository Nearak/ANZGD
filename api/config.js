// يرجع إعدادات Supabase العامة (URL + anon key) للواجهة الأمامية.
// anon key مصمم أصلاً ليكون علني — الحماية الحقيقية عبر Row Level Security بقاعدة البيانات،
// وليس عبر إخفاء هذا المفتاح.

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      error: "SUPABASE_URL أو SUPABASE_ANON_KEY غير مضبوطين على الخادم.",
    });
  }

  return res.status(200).json({ supabaseUrl, supabaseAnonKey });
}
