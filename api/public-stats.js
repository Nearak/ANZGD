export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(200).json({ activeSubscribers: 0, accuracyText: "قيد التجميع" });
  }
  const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  let activeSubscribers = 0;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?is_active=eq.true&select=id`, {
      headers: { ...sbHeaders, Prefer: "count=exact" },
    });
    const countHeader = r.headers.get("content-range"); // شكلها "0-4/5"
    activeSubscribers = countHeader ? parseInt(countHeader.split("/")[1] || "0", 10) : (await r.json()).length;
  } catch (e) {}

  let accuracyText = "قيد التجميع";
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.public_accuracy_text&select=value`, { headers: sbHeaders });
    const rows = await r.json();
    accuracyText = rows?.[0]?.value?.text || accuracyText;
  } catch (e) {}

  return res.status(200).json({ activeSubscribers, accuracyText });
}
