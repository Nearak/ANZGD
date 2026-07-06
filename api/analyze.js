// Vercel Serverless Function
// يستقبل { system, content } من الواجهة الأمامية، وينادي Anthropic API
// بمفتاح سري مخزّن كمتغير بيئة (Environment Variable) بعيد عن أي زائر للموقع.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "الطريقة غير مسموحة، استخدم POST." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY غير مضبوط على الخادم. أضفه من إعدادات Environment Variables بـ Vercel.",
    });
  }

  try {
    const { system, content } = req.body || {};
    if (!content) {
      return res.status(400).json({ error: "الطلب ناقص (content مفقود)." });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1200,
        system: system || undefined,
        messages: [{ role: "user", content }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "حدث خطأ أثناء الاتصال بـ Anthropic API.",
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || "خطأ غير متوقع بالخادم." });
  }
}
