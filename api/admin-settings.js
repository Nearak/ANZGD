export default async function handler(req, res) {
  const secret = req.headers["x-admin-secret"];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "غير مصرح." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: "إعدادات Supabase غير مكتملة." });
  }
  const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

  if (req.method === "GET") {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?select=key,value`, { headers: sbHeaders });
      const rows = await r.json();
      const map = {};
      (rows || []).forEach((row) => { map[row.key] = row.value; });
      return res.status(200).json({
        default_daily_limit: map.default_daily_limit?.limit ?? 5,
        public_accuracy_text: map.public_accuracy_text?.text ?? "قيد التجميع",
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { default_daily_limit, public_accuracy_text } = req.body || {};
    try {
      if (typeof default_daily_limit === "number") {
        await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
          method: "POST",
          headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ key: "default_daily_limit", value: { limit: default_daily_limit } }),
        });
      }
      if (typeof public_accuracy_text === "string") {
        await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
          method: "POST",
          headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ key: "public_accuracy_text", value: { text: public_accuracy_text } }),
        });
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "الطريقة غير مسموحة." });
}
