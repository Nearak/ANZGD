// يفعّل أو يعطّل حساب مستخدم — محمي بكلمة سر إدارية بسيطة (ADMIN_SECRET).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "الطريقة غير مسموحة." });
  }

  const secret = req.headers["x-admin-secret"];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "غير مصرح — كلمة السر الإدارية غير صحيحة." });
  }

  const { id, is_active, notes } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: "id مفقود." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: "إعدادات Supabase غير مكتملة على الخادم." });
  }

  const body = {};
  if (typeof is_active === "boolean") body.is_active = is_active;
  if (typeof notes === "string") body.notes = notes;

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.message || "خطأ من Supabase." });
    }
    return res.status(200).json({ updated: data });
  } catch (e) {
    return res.status(500).json({ error: e.message || "خطأ غير متوقع." });
  }
}
