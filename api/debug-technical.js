// نقطة تشخيص مؤقتة — تفتحها بالمتصفح مباشرة (GET) وبتوريك بالضبط شو صار
// لما حاولنا نتصل بـ gold-api.com، بدون داعي للبحث بسجلات Vercel.
// ملاحظة: احذف هذا الملف بعد ما تنتهي من التشخيص (مو خطير، بس مو لازم يضل موجود بالإنتاج).

export default async function handler(req, res) {
  const report = { steps: [] };

  const apiKey = process.env.GOLD_API_KEY;
  report.steps.push({
    step: "GOLD_API_KEY مضبوط بالخادم؟",
    result: apiKey ? `أيوة، موجود (يبلش بـ: ${apiKey.slice(0, 6)}...، طوله ${apiKey.length} حرف)` : "❌ لأ، غير موجود إطلاقاً",
  });

  if (!apiKey) {
    return res.status(200).json(report);
  }

  const end = Math.floor(Date.now() / 1000);
  const start = end - 90 * 24 * 60 * 60;
  const url = `https://api.gold-api.com/history?symbol=XAU&startTimestamp=${start}&endTimestamp=${end}&groupBy=day&aggregation=avg&orderBy=asc`;

  try {
    const r = await fetch(url, { headers: { "x-api-key": apiKey } });
    const bodyText = await r.text();
    report.steps.push({
      step: "الاتصال بـ gold-api.com/history",
      httpStatus: r.status,
      httpStatusText: r.statusText,
      responseBody: bodyText.slice(0, 1000),
    });
  } catch (e) {
    report.steps.push({
      step: "الاتصال بـ gold-api.com/history",
      exception: e.message || String(e),
    });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  report.steps.push({
    step: "SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY مضبوطين؟",
    result: SUPABASE_URL && SERVICE_KEY ? "أيوة" : "❌ لأ",
  });

  return res.status(200).json(report);
}
