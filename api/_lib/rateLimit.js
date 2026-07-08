// يدير الحد اليومي لعدد التحليلات المسموحة لكل مستخدم — لحماية حصة Gemini/gold-api المجانية
// من الاستهلاك الزائد. الحد الافتراضي قابل للتعديل من لوحة التحكم (app_settings)، وكل مستخدم
// ممكن يكون عنده حد مخصص (daily_limit_override) يتجاوز الافتراضي.

const DEFAULT_LIMIT_FALLBACK = 5; // لو ما في أي إعداد محفوظ إطلاقاً

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function sbFetch(path, opts = {}) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

export async function getDefaultDailyLimit() {
  try {
    const r = await sbFetch(`/rest/v1/app_settings?key=eq.default_daily_limit&select=value`);
    if (!r.ok) return DEFAULT_LIMIT_FALLBACK;
    const rows = await r.json();
    const v = rows?.[0]?.value;
    const n = typeof v === "object" ? v?.limit : v;
    return typeof n === "number" && n > 0 ? n : DEFAULT_LIMIT_FALLBACK;
  } catch (e) {
    return DEFAULT_LIMIT_FALLBACK;
  }
}

async function getUserOverride(userId) {
  try {
    const r = await sbFetch(`/rest/v1/profiles?id=eq.${userId}&select=daily_limit_override`);
    if (!r.ok) return null;
    const rows = await r.json();
    const n = rows?.[0]?.daily_limit_override;
    return typeof n === "number" && n > 0 ? n : null;
  } catch (e) {
    return null;
  }
}

async function getTodayUsage(userId) {
  try {
    const r = await sbFetch(`/rest/v1/usage_daily?user_id=eq.${userId}&day=eq.${todayStr()}&select=count`);
    if (!r.ok) return 0;
    const rows = await r.json();
    return rows?.[0]?.count || 0;
  } catch (e) {
    return 0;
  }
}

async function incrementUsage(userId, currentCount) {
  try {
    await sbFetch(`/rest/v1/usage_daily?on_conflict=user_id,day`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ user_id: userId, day: todayStr(), count: currentCount + 1 }),
    });
  } catch (e) {
    console.error("[rateLimit] فشل تسجيل الاستخدام:", e.message || e);
  }
}

/**
 * يتحقق من الحد اليومي، وإذا لسا ما وصله يسجل استخدام جديد فوراً (عشان يمنع تسابق طلبات متزامنة).
 * يرجع: { allowed, used, limit }
 */
export async function checkAndIncrementUsage(userId) {
  const [defaultLimit, override, used] = await Promise.all([
    getDefaultDailyLimit(),
    getUserOverride(userId),
    getTodayUsage(userId),
  ]);
  const limit = override ?? defaultLimit;

  if (used >= limit) {
    return { allowed: false, used, limit };
  }

  await incrementUsage(userId, used);
  return { allowed: true, used: used + 1, limit };
}
