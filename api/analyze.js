// Vercel Serverless Function
// يستقبل { system, content } من الواجهة الأمامية (بصيغة أنماط Anthropic: text/image)
// ويحوّلها وينادي Google Gemini API المجاني، ويرجع الرد بنفس شكل رد Anthropic
// حتى ما نحتاج نغيّر شي بالواجهة الأمامية (index.html).

import { verifyActiveUser } from "./_lib/auth.js";

function toGeminiParts(content) {
  return content.map((block) => {
    if (block.type === "text") return { text: block.text };
    if (block.type === "image") {
      return {
        inline_data: {
          mime_type: block.source.media_type,
          data: block.source.data,
        },
      };
    }
    return null;
  }).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "الطريقة غير مسموحة، استخدم POST." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY غير مضبوط على الخادم. أضفه من إعدادات Environment Variables بـ Vercel.",
    });
  }

  const auth = await verifyActiveUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  try {
    const { system, content } = req.body || {};
    if (!content) {
      return res.status(400).json({ error: "الطلب ناقص (content مفقود)." });
    }

    const parts = toGeminiParts(content);
    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: {
          maxOutputTokens: 3000,
          temperature: 0.4,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "حدث خطأ أثناء الاتصال بـ Gemini API.",
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text) {
      return res.status(502).json({ error: "لم يرجع Gemini أي نص (ربما تم حظر المحتوى - finishReason: " + (data?.candidates?.[0]?.finishReason || "غير معروف") + ")." });
    }

    // نرجع بنفس شكل رد Anthropic القديم حتى تشتغل الواجهة الأمامية بدون أي تعديل
    return res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    return res.status(500).json({ error: err.message || "خطأ غير متوقع بالخادم." });
  }
}
