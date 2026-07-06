// Vercel Serverless Function
// يجيب تلقائياً: سعر الذهب اللحظي + أحدث بيانات COT + أهم عناوين الأخبار
// من مصادر مجانية عامة بدون أي مفتاح API، ثم يرسلها لـ Google Gemini (مجاني) للتحليل.

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

  try {
    const [priceInfo, cotRows, headlines, calendar] = await Promise.all([
      fetchGoldPrice(),
      fetchCotRows(),
      fetchNews(),
      fetchEconomicCalendar(),
    ]);

    const sys = `أنت محلل أسواق محترف متخصص بالذهب (XAUUSD) وتقارير الالتزامات التجارية (COT) الصادرة عن CFTC.
البيانات المُعطاة لك بالأسفل تم جلبها تلقائياً قبل لحظات من مصادر حية (سعر لحظي، بيانات COT رسمية من CFTC، عناوين أخبار حديثة، وتقويم اقتصادي أسبوعي للأحداث القادمة) — اعتبرها بيانات حقيقية وحالية فعلاً، ولا تشكك بحداثتها.

مهم بخصوص التقويم الاقتصادي: هذي أحداث لسا ما صارت (مستقبلية خلال هذا الأسبوع). استخدمها لتحديد نقاط تقلب متوقعة قريباً (مثلاً: صدور بيانات تضخم أو قرار فائدة يوم معين) واذكرها صراحة ضمن key_drivers أو risks حسب أهميتها، مع ذكر اسم الحدث وتوقيته إن أمكن.

مهم جداً: التزم بالحدود التالية لكل حقل نصي (لديك مساحة كافية، لا داعي للاختصار المبالغ فيه):
- summary: 3 إلى 4 جمل، تشرح الخلاصة والسبب الرئيسي وراء التوقع بوضوح.
- cot_reading: 2 إلى 3 جمل تشرح تحديداً أرقام المراكز (net positioning، التغير الأسبوعي) ودلالتها.
- news_reading: 2 إلى 3 جمل تربط عناوين محددة (اذكرها) بتأثيرها المتوقع على الذهب. تجاهل تماماً أي عنوان لا علاقة له بالاقتصاد الكلي أو الذهب أو الدولار أو الفائدة (مثل أخبار شركات تقنية أو صفقات غير مرتبطة).
- key_drivers: 3 إلى 4 عناصر، كل عنصر جملة كاملة واضحة (حتى 18 كلمة).
- key_levels: عنصران كحد أقصى بكل مصفوفة (support/resistance)، كل عنصر رقم أو نطاق قصير فقط مثل "3320-3330"، محسوبة بالنسبة للسعر الحالي المُعطى فعلياً.
- risks: 2 إلى 3 عناصر، كل عنصر جملة واضحة (حتى 18 كلمة).

إذا كانت بيانات COT أو الأخبار فارغة أو غير متاحة (تعذر الجلب)، اذكر ذلك بوضوح ضمن الحقل النصي المناسب بدل تجاهل الأمر أو اختلاق بيانات.

أجب حصراً بصيغة JSON صالحة ومكتملة (تأكد من إغلاق كل الأقواس والاقتباسات) بدون أي نص إضافي قبله أو بعده وبدون Markdown، بالمفاتيح التالية بالضبط:
{
  "trend": "صعودي" | "هبوطي" | "محايد",
  "score": رقم من -100 إلى 100,
  "confidence": رقم من 0 إلى 100,
  "summary": "...",
  "cot_reading": "...",
  "news_reading": "...",
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
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (!text) {
      return res.status(502).json({ error: "لم يرجع Gemini أي نص (finishReason: " + (finishReason || "غير معروف") + ")." });
    }
    if (finishReason === "MAX_TOKENS") {
      return res.status(200).json({
        content: [{ type: "text", text }],
        _sources: { price: priceInfo, cotRows, headlines, calendar },
        _truncated: true,
      });
    }

    // نرجع بنفس شكل رد Anthropic القديم + البيانات الخام للشفافية بالواجهة
    return res.status(200).json({
      content: [{ type: "text", text }],
      _sources: { price: priceInfo, cotRows, headlines, calendar },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "خطأ غير متوقع بالخادم." });
  }
}
