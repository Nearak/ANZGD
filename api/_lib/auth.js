// دالة مساعدة مشتركة: تتحقق من صلاحية جلسة تسجيل الدخول (JWT من Supabase)
// وإن كان حساب المستخدم مُفعّل (is_active = true) بجدول profiles، قبل السماح باستخدام الذكاء الاصطناعي.

export async function verifyActiveUser(req) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return { ok: false, status: 401, error: "لازم تسجل دخول أولاً." };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { ok: false, status: 500, error: "إعدادات Supabase غير مكتملة على الخادم." };
  }

  try {
    // 1. تحقق من صلاحية التوكن واستخرج هوية المستخدم
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY || SERVICE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!userRes.ok) {
      return { ok: false, status: 401, error: "جلسة الدخول غير صالحة، سجل دخول من جديد." };
    }
    const user = await userRes.json();
    if (!user?.id) {
      return { ok: false, status: 401, error: "تعذر التعرف على المستخدم." };
    }

    // 2. تحقق من حالة التفعيل بجدول profiles (باستخدام مفتاح الخدمة السري لتجاوز RLS)
    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=is_active`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!profRes.ok) {
      return { ok: false, status: 500, error: "تعذر التحقق من حالة الحساب." };
    }
    const rows = await profRes.json();
    const isActive = rows?.[0]?.is_active === true;
    if (!isActive) {
      return { ok: false, status: 403, error: "حسابك غير مفعل بعد. تواصل معنا لتفعيله بعد إتمام الدفع." };
    }

    return { ok: true, userId: user.id, email: user.email };
  } catch (e) {
    return { ok: false, status: 500, error: "خطأ أثناء التحقق من الحساب." };
  }
}
