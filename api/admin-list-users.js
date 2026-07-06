// يرجع قائمة كل المستخدمين وحالة تفعيلهم — محمي بكلمة سر إدارية بسيطة (ADMIN_SECRET).

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "الطريقة غير مسموحة." });
  }

  const secret = req.headers["x-admin-secret"];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "غير مصرح — كلمة السر الإدارية غير صحيحة." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: "إعدادات Supabase غير مكتملة على الخادم." });
  }

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=id,email,is_active,notes,created_at&order=created_at.desc`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.message || "خطأ من Supabase." });
    }
    return res.status(200).json({ users: data });
  } catch (e) {
    return res.status(500).json({ error: e.message || "خطأ غير متوقع." });
  }
}
