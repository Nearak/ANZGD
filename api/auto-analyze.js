// Vercel Serverless Function
// Bilingual auto-analysis with Black-Scholes integration

import { verifyActiveUser } from "./_lib/auth.js";
import { getTechnicalSnapshot } from "./_lib/priceHistory.js";
import { checkAndIncrementUsage } from "./_lib/rateLimit.js";

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; GoldCotDesk/1.0)" };

// ============ دوال جلب البيانات ============

async function fetchGoldPrice() {
  try {
    const r = await fetch("https://api.gold-api.com/price/XAU", { headers: HEADERS });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

async function fetchCotRows() {
  try {
    const where = encodeURIComponent("upper(market_and_exchange_names) like '%GOLD%'");
    const order = encodeURIComponent("report_date_as_yyyy_mm_dd DESC");
    const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=${where}&$order=${order}&$limit=3`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) return [];
    return await r.json();
  } catch (e) { return []; }
}

function parseRssTitles(xml, limit) {
  const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/g)].slice(0, limit);
  return items.map((m) => {
    const block = m[0];
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    return titleMatch ? titleMatch[1].trim() : null;
  }).filter(Boolean);
}

async function fetchRss(url, limit) {
  try {
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRssTitles(xml, limit);
  } catch (e) { return []; }
}

async function fetchEconomicCalendar() {
  try {
    const r = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { headers: HEADERS });
    if (!r.ok) return [];
    const data = await r.json();
    return (data || []).filter((ev) => ev.country === "USD" && (ev.impact === "High" || ev.impact === "Medium")).slice(0, 12);
  } catch (e) { return []; }
}

async function fetchNews() {
  const queries = [
    '"gold price" OR XAUUSD OR "gold prices"',
    '"Federal Reserve" OR "Fed rate" OR "interest rate" gold',
    '"CPI" OR "Non-Farm Payrolls" OR "PCE inflation" OR "dollar index"',
  ];
  const results = await Promise.all(
    queries.map((q) => fetchRss(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:3d&hl=en-US&gl=US&ceid=US:en`, 8))
  );
  let combined = [...new Set(results.flat())];
  if (combined.length < 4) {
    const [a, b] = await Promise.all([
      fetchRss("https://www.forexlive.com/feed/news", 6),
      fetchRss("https://news.goldseek.com/newsRSS.xml", 6),
    ]);
    combined = [...new Set([...combined, ...a, ...b])];
  }
  return combined.slice(0, 14);
}

// ============ السندات والدولار ============

async function fetchTreasuryYield() {
  const apiKey = process.env.ALPHA_VANTAGE_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=monthly&maturity=10year&apikey=${apiKey}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.data && data.data.length > 0) {
      return parseFloat(data.data[0].value);
    }
    return null;
  } catch (e) { return null; }
}

async function fetchDXY() {
  const apiKey = process.env.ALPHA_VANTAGE_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://www.alphavantage.co/query?function=DXY&apikey=${apiKey}`;
    const r = await fetch(url);
    const data = await r.json();
    const price = data['Global Quote']?.['05. price'];
    return price ? parseFloat(price) : null;
  } catch (e) { return null; }
}

// ============ SYSTEM PROMPTS ============

const SYSTEM_PROMPT_AR = `أنت محلل أسواق محترف متخصص بالذهب (XAUUSD)، خبير بتقارير COT الصادرة عن CFTC وبالتحليل الفني الكلاسيكي والرياضيات المالية.
البيانات المُعطاة لك بالأسفل تم جلبها/حسابها تلقائياً قبل لحظات من مصادر حية وحسابات رياضية حقيقية (سعر لحظي، بيانات COT رسمية من CFTC، عناوين أخبار حديثة، تقويم اقتصادي أسبوعي، مؤشرات فنية كلاسيكية، نماذج Black-Scholes احتمالية، عائد السندات الأمريكية لأجل 10 سنوات، مؤشر الدولار، بالإضافة إلى بيانات محاكاة لفريمات 1 ساعة و4 ساعات ومستويات البيفوت اليومية وATR) — اعتبرها بيانات حقيقية وحالية فعلاً، ولا تشكك بحداثتها.

منهجية التحليل الإلزامية — حلل 7 محاور منفصلة أولاً، ثم اجمعهم بخلاصة نهائية:
1. **COT (تمركز المؤسسات):** هل هناك تمركز مفرط؟ هل التغير الأسبوعي يدعم استمرار الاتجاه أم يشير لاحتمال انعكاس؟
2. **الأخبار والسياسة النقدية:** ماذا تعني العناوين المتاحة تحديداً (اذكرها) بالنسبة لتوقعات الفائدة وقوة الدولار؟
3. **التقويم الاقتصادي القادم:** ما هي أقرب الأحداث عالية الأهمية القادمة، ومتى، وما تأثيرها المحتمل؟
4. **التحليل الفني الكلاسيكي:** ماذا تقول المؤشرات المحسوبة (RSI، MACD، المتوسطات المتحركة، نطاقات بولينجر) عن الزخم الحالي؟
5. **Black-Scholes والاحتماليات:** بناءً على التقلب التاريخي، ما هي الحركة المتوقعة هذا الأسبوع؟ ما نسبة احتمالية بقاء السعر ضمن نطاق بولينجر؟ كيف تُستخدم هذه الأرقام لتحديد نقاط دخول/خروج أكثر دقة؟
6. **السندات والدولار:** كيف تؤثر عوائد السندات الأمريكية (10 سنوات) ومؤشر الدولار على الذهب؟ هل العلاقة العكسية قوية حالياً؟
7. **تحليل الفريمات القصيرة (1س، 4س) والمؤشرات الداعمة:** باستخدام مستويات البيفوت وATR المتوفرة، حلل الاتجاه على الفريمات القصيرة وحدد نقاط الدعم والمقاومة القريبة. استخدم ATR لتحديد وقف الخسارة وجني الأرباح المناسبين.

بعد تحليل المحاور، اكتب خلاصة نهائية (summary) توضح صراحة: هل المحاور متفقَة أم متعارضة؟ أي محور له الوزن الأكبر؟

**الخطوة الثامنة — Zoom Out / Zoom In:** وفر نظرة أوسع (أسبوعية وشهرية) للسياق العام، بالإضافة إلى التحليل اليومي الدقيق.

**الخطوة التاسعة — تحليل المشاعر:** استخرج من الأخبار الخبر الأكثر تأثيراً حالياً وحدد درجة تأثيره (إيجابي قوي/سلبي ضعيف/محايد) مع ذكر السبب.

**الخطوة العاشرة — التوصيات العملية:** استخدم ATR لتحديد وقف خسارة منطقي، واستخدم البيفوت والمقاومات لتحديد جني أرباح. اكتب توصية واضحة للمتداول اليومي.

مهم جداً: التزم بالحدود التالية لكل حقل نصي:
- summary: 4-5 جمل.
- cot_reading: 2-3 جمل.
- news_reading: 2-3 جمل.
- calendar_reading: 1-2 جملة.
- technical_reading: 2-3 جمل.
- black_scholes_reading: 2-3 جمل.
- bs_recommendation: جملة واحدة.
- current_situation: 3-4 جمل.
- scenarios.bullish: 2-3 جمل.
- scenarios.bearish: 2-3 جمل.
- invalidation_level: رقم أو نطاق قصير.
- key_drivers: 3-4 عناصر.
- key_levels: دعم ومقاومة (رقم أو نطاق).
- risks: 2-3 عناصر.
- daily_outlook: 3-4 جمل تحليلية للمتداول اليومي مع ذكر الاتجاه ومستويات الدعم/المقاومة القريبة.
- weekly_context: 2-3 جمل (النظرة الأسبوعية).
- monthly_context: 1-2 جملة (النظرة الشهرية).
- sentiment_analysis: جملة أو اثنتين عن الخبر الأكثر تأثيراً وتأثيره.
- stop_loss_suggestion: رقم أو نطاق (مثل 3300 أو 3290-3300).
- take_profit_suggestion: رقم أو نطاق (مثل 3360 أو 3350-3370).

أجب حصراً بصيغة JSON صالحة ومكتملة، بالمفاتيح التالية:
{
  "trend": "صعودي" | "هبوطي" | "محايد",
  "score": رقم,
  "confidence": رقم,
  "summary": "...",
  "cot_reading": "...",
  "news_reading": "...",
  "calendar_reading": "...",
  "technical_reading": "...",
  "black_scholes_reading": "...",
  "bs_recommendation": "...",
  "current_situation": "...",
  "scenarios": {"bullish": "...", "bearish": "..."},
  "invalidation_level": "...",
  "key_drivers": ["...", "...", "..."],
  "key_levels": {"support": ["..."], "resistance": ["..."]},
  "risks": ["...", "..."],
  "treasury_yield_value": رقم أو null,
  "dxy_value": رقم أو null,
  "daily_outlook": "...",
  "weekly_context": "...",
  "monthly_context": "...",
  "sentiment_analysis": "...",
  "stop_loss_suggestion": "...",
  "take_profit_suggestion": "..."
}`;

// النسخة الإنجليزية (مختصرة، نفس المحتوى مترجم)
const SYSTEM_PROMPT_EN = `You are a professional market analyst specializing in Gold (XAUUSD), expert in CFTC COT reports, classical technical analysis, and financial mathematics.
The data provided below was fetched/computed automatically moments ago from live sources (price, CFTC COT, news, economic calendar, technical indicators, Black-Scholes models, treasury yields, DXY, plus simulated 1H/4H data, pivot levels, and ATR). Treat it as real and current.

Mandatory Analysis — analyze 7 pillars:
1. COT institutional positioning.
2. News and monetary policy.
3. Upcoming economic calendar.
4. Classical technical indicators (RSI, MACD, SMA, Bollinger).
5. Black-Scholes probabilities and expected moves.
6. Treasury yields and DXY impact.
7. Short-term timeframe analysis (1H/4H) using pivots and ATR for stop-loss and take-profit levels.

After analysis, provide a final summary.
Also provide:
- Weekly and monthly context (Zoom Out).
- Sentiment analysis from news.
- Practical stop-loss and take-profit suggestions based on ATR and pivot levels.

Respond ONLY with valid JSON using exactly these keys:
{
  "trend": "Bullish" | "Bearish" | "Neutral",
  "score": number,
  "confidence": number,
  "summary": "...",
  "cot_reading": "...",
  "news_reading": "...",
  "calendar_reading": "...",
  "technical_reading": "...",
  "black_scholes_reading": "...",
  "bs_recommendation": "...",
  "current_situation": "...",
  "scenarios": {"bullish": "...", "bearish": "..."},
  "invalidation_level": "...",
  "key_drivers": ["...", "...", "..."],
  "key_levels": {"support": ["..."], "resistance": ["..."]},
  "risks": ["...", "..."],
  "treasury_yield_value": number or null,
  "dxy_value": number or null,
  "daily_outlook": "...",
  "weekly_context": "...",
  "monthly_context": "...",
  "sentiment_analysis": "...",
  "stop_loss_suggestion": "...",
  "take_profit_suggestion": "..."
}`;

// ============ بناء رسالة المستخدم ============

function buildUserMessage(priceInfo, cotRows, headlines, calendar, technical, treasuryYield, dxy, lang) {
  const isAr = lang === 'ar';

  const bsData = technical?.historicalVolatility
    ? (isAr 
      ? `**بيانات Black-Scholes (محسوبة رياضياً من بيانات تاريخية حقيقية):**
- التقلب التاريخي السنوي: ${(technical.historicalVolatility * 100).toFixed(1)}%
- الحركة المتوقعة خلال 7 أيام: ±$${technical.expectedMove7d?.toFixed(2) || "-"} (من ${technical.lastClose.toFixed(2)})
- الحركة المتوقعة خلال 30 يوم: ±$${technical.expectedMove30d?.toFixed(2) || "-"}
- النطاق المتوقع 68% خلال أسبوع: ${technical.expectedRange7d?.lower.toFixed(2) || "-"} - ${technical.expectedRange7d?.upper.toFixed(2) || "-"}
- النطاق المتوقع 95% خلال أسبوع: ${technical.expectedRange7d95?.lower.toFixed(2) || "-"} - ${technical.expectedRange7d95?.upper.toFixed(2) || "-"}
- احتمالية بقاء السعر ضمن نطاق بولينجر هذا الأسبوع: ${technical.probInBollinger7d != null ? (technical.probInBollinger7d * 100).toFixed(1) + "%" : "غير محسوبة"}
- احتمالية أن يكون السعر أعلى من SMA20 بعد أسبوع: ${technical.probAboveSMA20 != null ? (technical.probAboveSMA20 * 100).toFixed(1) + "%" : "غير محسوبة"}
- احتمالية أن يكون السعر أعلى من SMA50 بعد أسبوع: ${technical.probAboveSMA50 != null ? (technical.probAboveSMA50 * 100).toFixed(1) + "%" : "غير محسوبة"}`
      : `**Black-Scholes Data (computed from actual historical data):**
- Annual Historical Volatility: ${(technical.historicalVolatility * 100).toFixed(1)}%
- Expected Move over 7 days: ±$${technical.expectedMove7d?.toFixed(2) || "-"} (from ${technical.lastClose.toFixed(2)})
- Expected Move over 30 days: ±$${technical.expectedMove30d?.toFixed(2) || "-"}
- Expected Range 68% (1 week): ${technical.expectedRange7d?.lower.toFixed(2) || "-"} - ${technical.expectedRange7d?.upper.toFixed(2) || "-"}
- Expected Range 95% (1 week): ${technical.expectedRange7d95?.lower.toFixed(2) || "-"} - ${technical.expectedRange7d95?.upper.toFixed(2) || "-"}
- Probability of staying within Bollinger Bands this week: ${technical.probInBollinger7d != null ? (technical.probInBollinger7d * 100).toFixed(1) + "%" : "Not computed"}
- Probability of price being above SMA20 in one week: ${technical.probAboveSMA20 != null ? (technical.probAboveSMA20 * 100).toFixed(1) + "%" : "Not computed"}
- Probability of price being above SMA50 in one week: ${technical.probAboveSMA50 != null ? (technical.probAboveSMA50 * 100).toFixed(1) + "%" : "Not computed"}`)
    : (isAr ? "**بيانات Black-Scholes:** تعذر حساب التقلب التاريخي (بيانات غير كافية)." : "**Black-Scholes Data:** Failed to compute historical volatility (insufficient data).");

  // بيانات الفريمات القصيرة
  const intraday1h = technical?.intraday1h;
  const intraday4h = technical?.intraday4h;
  const intradayText = isAr
    ? `**تحليل الفريمات القصيرة (محاكاة من بيانات يومية - 1 ساعة و 4 ساعات):**
- فريم 1 ساعة: أخر سعر ${intraday1h?.close?.toFixed(2) || "-"} · RSI14: ${intraday1h?.rsi14?.toFixed(1) || "-"} · ATR(14): ${intraday1h?.atr?.toFixed(2) || "-"}
- فريم 4 ساعات: أخر سعر ${intraday4h?.close?.toFixed(2) || "-"} · RSI14: ${intraday4h?.rsi14?.toFixed(1) || "-"} · ATR(14): ${intraday4h?.atr?.toFixed(2) || "-"}`
    : `**Short-term Timeframe Analysis (simulated from daily data - 1H & 4H):**
- 1H Frame: Last ${intraday1h?.close?.toFixed(2) || "-"} · RSI14: ${intraday1h?.rsi14?.toFixed(1) || "-"} · ATR(14): ${intraday1h?.atr?.toFixed(2) || "-"}
- 4H Frame: Last ${intraday4h?.close?.toFixed(2) || "-"} · RSI14: ${intraday4h?.rsi14?.toFixed(1) || "-"} · ATR(14): ${intraday4h?.atr?.toFixed(2) || "-"}`;

  // البيفوت وATR
  const pivot = technical?.pivot;
  const pivotText = isAr
    ? `**مستويات البيفوت اليومية (محسوبة):**
الدعم الأول (S1): ${pivot?.s1?.toFixed(2) || "-"} · الدعم الثاني (S2): ${pivot?.s2?.toFixed(2) || "-"}
المحور (Pivot): ${pivot?.pivot?.toFixed(2) || "-"}
المقاومة الأولى (R1): ${pivot?.r1?.toFixed(2) || "-"} · المقاومة الثانية (R2): ${pivot?.r2?.toFixed(2) || "-"}
ATR اليومي المقدر: ${technical?.atr ? "$" + technical.atr.toFixed(2) : "-"}`
    : `**Daily Pivot Levels (calculated):**
Support 1 (S1): ${pivot?.s1?.toFixed(2) || "-"} · Support 2 (S2): ${pivot?.s2?.toFixed(2) || "-"}
Pivot: ${pivot?.pivot?.toFixed(2) || "-"}
Resistance 1 (R1): ${pivot?.r1?.toFixed(2) || "-"} · Resistance 2 (R2): ${pivot?.r2?.toFixed(2) || "-"}
Estimated Daily ATR: ${technical?.atr ? "$" + technical.atr.toFixed(2) : "-"}`;

  // الماكرو
  const macroText = isAr
    ? `**بيانات السندات والدولار:**
- عائد سندات الخزانة لأجل 10 سنوات: ${treasuryYield != null ? treasuryYield.toFixed(2) + '%' : 'غير متوفر'}
- مؤشر الدولار (DXY): ${dxy != null ? dxy.toFixed(2) : 'غير متوفر'}`
    : `**Treasury & Dollar Data:**
- 10-Year Treasury Yield: ${treasuryYield != null ? treasuryYield.toFixed(2) + '%' : 'N/A'}
- US Dollar Index (DXY): ${dxy != null ? dxy.toFixed(2) : 'N/A'}`;

  if (isAr) {
    return `السعر الحالي الفعلي للذهب XAUUSD الآن: ${priceInfo ? `${priceInfo.price} دولار (آخر تحديث: ${priceInfo.updatedAtReadable})` : "تعذر جلب السعر الآن من المصدر الحي."}

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

${macroText}

${pivotText}

${intradayText}

${bsData}

حلل الوضع وأعطني توقعك الأسبوعي التزاماً بصيغة الـ JSON المطلوبة فقط.`;
  } else {
    return `Current live price of Gold XAUUSD right now: ${priceInfo ? `$${priceInfo.price} (Last update: ${priceInfo.updatedAtReadable})` : "Failed to fetch live price from source."}

Latest COT report data (Legacy Futures Only - Gold) directly from CFTC, raw JSON format (may contain multiple weeks for comparison, newest first):
"""
${cotRows && cotRows.length ? JSON.stringify(cotRows, null, 2) : "Failed to fetch COT data currently from live source."}
"""

Most important economic headlines related to gold right now (from live news sources):
"""
${headlines && headlines.length ? headlines.map((h, i) => `${i + 1}. ${h}`).join("\n") : "Failed to fetch headlines currently from live source."}
"""

Economic calendar for this week — upcoming USD high/medium importance events (not happened yet), raw JSON format:
"""
${calendar && calendar.length ? JSON.stringify(calendar, null, 2) : "Failed to fetch economic calendar currently from live source."}
"""

Classical technical indicators — actually computed (mathematically) from real daily price data (last ~${technical?.dataPoints || "?"} days):
"""
${technical ? `- Last daily close price used in calculations: ${technical.lastClose.toFixed(2)}
- Simple Moving Average 20-day (SMA20): ${technical.sma20 != null ? technical.sma20.toFixed(2) : "Insufficient data"}
- Simple Moving Average 50-day (SMA50): ${technical.sma50 != null ? technical.sma50.toFixed(2) : "Insufficient data"}
- Relative Strength Index RSI(14): ${technical.rsi14 != null ? technical.rsi14.toFixed(1) : "Insufficient data"}
- MACD(12,26,9): ${technical.macd ? `MACD line = ${technical.macd.macd.toFixed(2)}, Signal line = ${technical.macd.signal.toFixed(2)}, Histogram = ${technical.macd.histogram.toFixed(2)}` : "Insufficient data"}
- Bollinger Bands (20, 2 std dev): Upper = ${technical.bollinger ? technical.bollinger.upper.toFixed(2) : "-"}, Middle = ${technical.bollinger ? technical.bollinger.mid.toFixed(2) : "-"}, Lower = ${technical.bollinger ? technical.bollinger.lower.toFixed(2) : "-"}` : "Failed to compute technical indicators currently (historical data not available)."}
"""

${macroText}

${pivotText}

${intradayText}

${bsData}

Analyze the situation and give me your weekly forecast adhering ONLY to the required JSON format.`;
  }
}

// ============ HANDLER ============

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY not set on server. Add it in Vercel Environment Variables.",
    });
  }

  const auth = await verifyActiveUser(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const usage = await checkAndIncrementUsage(auth.userId);
  if (!usage.allowed) {
    return res.status(429).json({
      error: `Daily limit reached (${usage.limit} analyses). Try again tomorrow or contact us to increase your limit.`,
      _usage: usage,
    });
  }

  const lang = req.body?.lang || req.headers["x-preferred-lang"] || "ar";
  const isAr = lang === 'ar';

  try {
    const [priceInfo, cotRows, headlines, calendar, technical, treasuryYield, dxy] = await Promise.all([
      fetchGoldPrice(),
      fetchCotRows(),
      fetchNews(),
      fetchEconomicCalendar(),
      getTechnicalSnapshot(),
      fetchTreasuryYield(),
      fetchDXY(),
    ]);

    const sys = isAr ? SYSTEM_PROMPT_AR : SYSTEM_PROMPT_EN;
    const userMsg = buildUserMessage(priceInfo, cotRows, headlines, calendar, technical, treasuryYield, dxy, lang);

    const model = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userMsg }] }],
        systemInstruction: { parts: [{ text: sys }] },
        generationConfig: {
          maxOutputTokens: 6000,
          temperature: 0.4,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Error connecting to Gemini API.",
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (!text) {
      return res.status(502).json({ error: "Gemini returned no text (finishReason: " + (finishReason || "unknown") + ")." });
    }
    if (finishReason === "MAX_TOKENS") {
      return res.status(200).json({
        content: [{ type: "text", text }],
        _sources: { price: priceInfo, cotRows, headlines, calendar, technical, treasuryYield, dxy },
        _usage: usage,
        _truncated: true,
      });
    }

    return res.status(200).json({
      content: [{ type: "text", text }],
      _sources: { price: priceInfo, cotRows, headlines, calendar, technical, treasuryYield, dxy },
      _usage: usage,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected server error." });
  }
}
