// Vercel Serverless Function
// يجيب تلقائياً: سعر الذهب اللحظي + أحدث بيانات COT + أهم عناوين الأخبار
// من مصادر مجانية عامة بدون أي مفتاح API، ثم يرسلها لـ Google Gemini (مجاني) للتحليل.

import { verifyActiveUser } from "./_lib/auth.js";
import { getTechnicalSnapshot } from "./_lib/priceHistory.js";

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; GoldCotDesk/1.0)" };

async function fetchGoldPrice() {
  try {
    const r = await fetch("https://api.gold-api.com/price/XAU", { headers: HEADERS });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

async function fetchCotRows() {
  try {
    const where = encodeURIComponent("upper(market_and_exchange_names) like '%GOLD%'");
    const order = encodeURIComponent("report_date_as_yyyy_mm_dd DESC");
    const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=${where}&$order=${order}&$limit=3`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) return [];
    return await r.json();
  } catch (e) {
    return [];
  }
}

function parseRssTitles(xml, limit) {
  const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/g)].slice(0, limit);
  return items
    .map((m) => {
      const block = m[0];
      const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
      return titleMatch ? titleMatch[1].trim() : null;
    })
    .filter(Boolean);
}

async function fetchRss(url, limit) {
  try {
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRssTitles(xml, limit);
  } catch (e) {
    return [];
  }
}

async function fetchEconomicCalendar() {
  try {
    const r = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { headers: HEADERS });
    if (!r.ok) return [];
    const data = await r.json();
    // نركز فقط على أحداث الدولار الأمريكي عالية/متوسطة الأهمية — الأكثر تأثيراً على الذهب
    return (data || [])
      .filter((ev) => ev.country === "USD" && (ev.impact === "High" || ev.impact === "Medium"))
      .slice(0, 12);
  } catch (e) {
    return [];
  }
}

async function fetchNews() {
  const queries = [
    '"gold price" OR XAUUSD OR "gold prices"',
    '"Federal Reserve" OR "Fed rate" OR "interest rate" gold',
    '"CPI" OR "Non-Farm Payrolls" OR "PCE inflation" OR "dollar index"',
  ];
  const results = await Promise.all(
    queries.map((q) =>
      fetchRss(
        `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:3d&hl=en-US&gl=US&ceid=US:en`,
        8
      )
    )
  );
  let combined = [...new Set(results.flat())];
  if (combined.length < 4) {
    // احتياطي لو Google News ما رجع شي كافي
    const [a, b] = await Promise.all([
      fetchRss("https://www.forexlive.com/feed/news", 6),
      fetchRss("https://news.goldseek.com/newsRSS.xml", 6),
    ]);
    combined = [...new Set([...combined, ...a, ...b])];
  }
  return combined.slice(0, 14);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "الطريقة غير مسموحة." });
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
    const [priceInfo, cotRows, headlines, calendar, technical] = await Promise.all([
      fetchGoldPrice(),
      fetchCotRows(),
      fetchNews(),
      fetchEconomicCalendar(),
      getTechnicalSnapshot(),
    ]);

    const sys = `أنت محلل أسواق محترف متخصص بالذهب (XAUUSD)، خبير بتقارير COT الصادرة عن CFTC وبالتحليل الفني الكلاسيكي.
البيانات المُعطاة لك بالأسفل تم جلبها/حسابها تلقائياً قبل لحظات من مصادر حية وحسابات رياضية حقيقية (سعر لحظي، بيانات COT رسمية من CFTC، عناوين أخبار حديثة، تقويم اقتصادي أسبوعي، ومؤشرات فنية كلاسيكية محسوبة من بيانات سعرية تاريخية فعلية) — اعتبرها بيانات حقيقية وحالية فعلاً، ولا تشكك بحداثتها.

منهجية التحليل الإلزامية — حلل 4 محاور منفصلة أولاً، ثم اجمعهم بخلاصة نهائية:
1. **COT (تمركز المؤسسات):** هل هناك تمركز مفرط لدى المضاربين غير التجاريين؟ هل التغير الأسبوعي يدعم استمرار الاتجاه أم يشير لاحتمال انعكاس؟
2. **الأخبار والسياسة النقدية:** ماذا تعني العناوين المتاحة تحديداً (اذكرها) بالنسبة لتوقعات الفائدة وقوة الدولار؟
3. **التقويم الاقتصادي القادم:** ما هي أقرب الأحداث عالية الأهمية القادمة، ومتى، وما تأثيرها المحتمل؟
4. **التحليل الفني الكلاسيكي:** ماذا تقول المؤشرات المحسوبة (RSI، MACD، المتوسطات المتحركة، نطاقات بولينجر) عن الزخم الحالي؟ هل هناك تشبع شرائي/بيعي، تقاطعات، أو اختراق نطاقات؟

بعد تحليل الأربعة، اكتب خلاصة نهائية (summary) توضح صراحة: هل المحاور الأربعة متفقة مع بعضها أم متعارضة؟ أي محور له الوزن الأكبر بقرارك ولماذا؟

مهم جداً: التزم بالحدود التالية لكل حقل نصي (لديك مساحة كافية، لا داعي للاختصار المبالغ فيه):
- summary: 4 إلى 5 جمل، تلخص التوافق/التعارض بين المحاور الأربعة والسبب الرئيسي وراء القرار النهائي.
- cot_reading: 2 إلى 3 جمل تشرح تحديداً أرقام المراكز ودلالتها.
- news_reading: 2 إلى 3 جمل تربط عناوين محددة بتأثيرها المتوقع على الذهب. تجاهل تماماً أي عنوان لا علاقة له بالاقتصاد الكلي أو الذهب أو الدولار أو الفائدة.
- calendar_reading: 1 إلى 2 جملة عن أقرب حدث/أحداث عالية الأهمية القادمة وتوقيتها المحتمل.
- technical_reading: 2 إلى 3 جمل تفسر تحديداً قراءات RSI وMACD والمتوسطات المتحركة وموقع السعر ضمن نطاقات بولينجر.
- key_drivers: 3 إلى 4 عناصر، كل عنصر جملة كاملة واضحة (حتى 18 كلمة).
- key_levels: عنصران كحد أقصى بكل مصفوفة (support/resistance)، كل عنصر رقم أو نطاق قصير فقط مثل "3320-3330"، محسوبة بالنسبة للسعر الحالي المُعطى فعلياً (وبالاستفادة من مستويات SMA/Bollinger إن كانت منطقية كدعم/مقاومة).
- risks: 2 إلى 3 عناصر، كل عنصر جملة واضحة (حتى 18 كلمة).

إذا كانت أي بيانات فارغة أو غير متاحة (تعذر الجلب/الحساب)، اذكر ذلك بوضوح ضمن الحقل النصي المناسب بدل تجاهل الأمر أو اختلاق بيانات.

أجب حصراً بصيغة JSON صالحة ومكتملة (تأكد من إغلاق كل الأقواس والاقتباسات) بدون أي نص إضافي قبله أو بعده وبدون Markdown، بالمفاتيح التالية بالضبط:
{
  "trend": "صعودي" | "هبوطي" | "محايد",
  "score": رقم من -100 إلى 100,
  "confidence": رقم من 0 إلى 100,
  "summary": "...",
  "cot_reading": "...",
  "news_reading": "...",
  "calendar_reading": "...",
  "technical_reading": "...",
  "key_drivers": ["...", "...", "..."],
  "key_levels": {"support": ["..."], "resistance": ["..."]},
  "risks": ["...", "..."]
}
الأولوية القصوى هي إرجاع JSON صالح ومكتمل حتى لو كان مختصراً جداً.`;

    const userMsg = `السعر الحالي الفعلي للذهب XAUUSD الآن: ${
      priceInfo ? `${priceInfo.price} دولار (آخر تحديث: ${priceInfo.updatedAtReadable})` : "تعذر جلب السعر الآن من المصدر الحي."
    }

أحدث بيانات تقرير COT (Legacy Futures Only - Gold) من CFTC مباشرة، بصيغة JSON خام (قد يحتوي على أكثر من أسبوع للمقارنة، الأحدث أولاً):
"""
${cotRows && cotRows.length ? JSON.stringify(cotRows, null, 2) : "تعذر جلب بيانات COT حالياً من المصدر الحي."}
"""

أهم العناوين الاقتصادية والمتعلقة بالذهب حالياً (من مصادر أخبار حية):
"""
${headlines && headlines.length ? headlines.map((h, i) => `${i + 1}. ${h}`).join("\n") : "تعذر جلب عناوين حالياً من المصدر الحي."}
"""

التقويم الاقتصادي لهذا الأسبوع — أحداث الدولار الأمريكي عالية/متوسطة الأهمية القادمة (لسا ما صارت)، بصيغة JSON خام:
"""
${calendar && calendar.length ? JSON.stringify(calendar, null, 2) : "تعذر جلب التقويم الاقتصادي حالياً من المصدر الحي."}
"""

المؤشرات الفنية الكلاسيكية — محسوبة فعلياً (رياضياً) من بيانات سعرية يومية حقيقية (آخر ${technical?.dataPoints || "؟"} يوم تقريباً):
"""
${technical ? `- آخر سعر إغلاق يومي مستخدم بالحسابات: ${technical.lastClose.toFixed(2)}
- المتوسط المتحرك البسيط 20 يوم (SMA20): ${technical.sma20 != null ? technical.sma20.toFixed(2) : "غير كافٍ من البيانات"}
- المتوسط المتحرك البسيط 50 يوم (SMA50): ${technical.sma50 != null ? technical.sma50.toFixed(2) : "غير كافٍ من البيانات"}
- مؤشر القوة النسبية RSI(14): ${technical.rsi14 != null ? technical.rsi14.toFixed(1) : "غير كافٍ من البيانات"}
- MACD(12,26,9): ${technical.macd ? `خط MACD = ${technical.macd.macd.toFixed(2)}، خط الإشارة = ${technical.macd.signal.toFixed(2)}، الهيستوجرام = ${technical.macd.histogram.toFixed(2)}` : "غير كافٍ من البيانات"}
- نطاقات بولينجر (20، 2 انحراف معياري): علوي = ${technical.bollinger ? technical.bollinger.upper.toFixed(2) : "-"}، أوسط = ${technical.bollinger ? technical.bollinger.mid.toFixed(2) : "-"}، سفلي = ${technical.bollinger ? technical.bollinger.lower.toFixed(2) : "-"}` : "تعذر حساب المؤشرات الفنية حالياً (بيانات تاريخية غير متوفرة حالياً)."}
"""

حلل الوضع وأعطني توقعك الأسبوعي التزاماً بصيغة الـ JSON المطلوبة فقط.`;

    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userMsg }] }],
        systemInstruction: { parts: [{ text: sys }] },
        generationConfig: {
          maxOutputTokens: 4096,
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
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (!text) {
      return res.status(502).json({ error: "لم يرجع Gemini أي نص (finishReason: " + (finishReason || "غير معروف") + ")." });
    }
    if (finishReason === "MAX_TOKENS") {
      return res.status(200).json({
        content: [{ type: "text", text }],
        _sources: { price: priceInfo, cotRows, headlines, calendar, technical },
        _truncated: true,
      });
    }

    // نرجع بنفس شكل رد Anthropic القديم + البيانات الخام للشفافية بالواجهة
    return res.status(200).json({
      content: [{ type: "text", text }],
      _sources: { price: priceInfo, cotRows, headlines, calendar, technical },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "خطأ غير متوقع بالخادم." });
  }
}
