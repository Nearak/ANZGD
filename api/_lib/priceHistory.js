// يجيب سلسلة أسعار يومية للذهب (آخر ~90 يوم) من gold-api.com، مع تخزين مؤقت (Cache)
// بجدول market_cache بقاعدة بيانات Supabase — لأن endpoint البيانات التاريخية محدود
// بـ10 طلبات بالساعة، وبكذا كل المشتركين بيستفيدوا من نفس النسخة المخزنة مؤقتاً.

import { sma, rsi, macd, bollinger } from "./indicators.js";
import { historicalVolatility, expectedMove, expectedRange, probabilityAbove, probabilityBelow, probabilityInRange } from "./blackScholes.js";

const CACHE_TTL_MINUTES = 45;
const CACHE_KEY = "xau_daily_series";

async function getCache() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/market_cache?key=eq.${CACHE_KEY}&select=value,updated_at`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return rows?.[0] || null;
  } catch (e) {
    return null;
  }
}

async function setCache(value) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/market_cache`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ key: CACHE_KEY, value, updated_at: new Date().toISOString() }),
    });
  } catch (e) {}
}

async function fetchFreshDailySeries() {
  const apiKey = process.env.GOLD_API_KEY;
  if (!apiKey) return null;
  const end = Math.floor(Date.now() / 1000);
  const start = end - 90 * 24 * 60 * 60;
  const url = `https://api.gold-api.com/history?symbol=XAU&startTimestamp=${start}&endTimestamp=${end}&groupBy=day&aggregation=avg&orderBy=asc`;
  try {
    const r = await fetch(url, { headers: { "x-api-key": apiKey } });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows.map((row) => Number(row.avg_price)).filter((v) => !isNaN(v));
  } catch (e) {
    return null;
  }
}

// ======== دوال جديدة لتحسين تحليل المتداول ========

// 1. حساب البيفوت اليومي (Pivot Points) - كلاسيكي
function calculatePivotPoints(high, low, close) {
  if (high == null || low == null || close == null) return null;
  const pivot = (high + low + close) / 3;
  const r1 = 2 * pivot - low;
  const s1 = 2 * pivot - high;
  const r2 = pivot + (high - low);
  const s2 = pivot - (high - low);
  const r3 = high + 2 * (pivot - low);
  const s3 = low - 2 * (high - pivot);
  return { pivot, r1, s1, r2, s2, r3, s3 };
}

// 2. تقدير ATR (متوسط المدى الحقيقي)
function estimateATR(lastClose, historicalVolatility, period = 14) {
  if (!lastClose || !historicalVolatility || historicalVolatility <= 0) return null;
  const dailyVol = historicalVolatility / Math.sqrt(252);
  return dailyVol * lastClose;
}

// 3. دالة لحساب ATR من سلسلة (للفريمات القصيرة)
function calcATRFromCloses(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = Math.abs(closes[i] - closes[i - 1]);
    trs.push(diff);
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

// 4. دالة لحساب RSI من سلسلة (للفريمات القصيرة)
function calcRSIFromCloses(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ======== التصدير الرئيسي ========

export async function getTechnicalSnapshot() {
  const cached = await getCache();
  let series = null;
  let fromCache = false;

  if (cached?.updated_at) {
    const ageMinutes = (Date.now() - new Date(cached.updated_at).getTime()) / 60000;
    if (ageMinutes < CACHE_TTL_MINUTES && Array.isArray(cached.value)) {
      series = cached.value;
      fromCache = true;
    }
  }

  if (!series) {
    series = await fetchFreshDailySeries();
    if (series && series.length > 0) {
      await setCache(series);
    } else if (cached && Array.isArray(cached.value)) {
      series = cached.value;
      fromCache = true;
    }
  }

  if (!series || series.length < 15) return null;

  const lastClose = series[series.length - 1];
  const hv = historicalVolatility(series);
  const riskFreeRate = 0.045;

  // المؤشرات الأساسية
  const sma20Val = series.length >= 20 ? sma(series, 20) : null;
  const sma50Val = series.length >= 50 ? sma(series, 50) : null;
  const bb = series.length >= 20 ? bollinger(series, 20, 2) : null;
  const rsi14 = rsi(series, 14);
  const macdVal = series.length >= 35 ? macd(series) : null;

  // --- الحسابات الجديدة ---
  // أعلى وأدنى سعر خلال آخر 5 أيام (للبيفوت)
  const last5 = series.slice(-5);
  const high5 = Math.max(...last5);
  const low5 = Math.min(...last5);
  const close = lastClose;

  // البيفوت اليومي
  const pivotData = calculatePivotPoints(high5, low5, close);

  // تقدير ATR
  const atrValue = estimateATR(lastClose, hv);

  // حساب ATR من السلسلة مباشرة
  const atrFromSeries = hv ? calcATRFromCloses(series, 14) : null;

  // تحليل الفريمات القصيرة (محاكاة من البيانات اليومية)
  // سنقوم بمحاكاة فريم 1 ساعة و 4 ساعات عن طريق تقسيم التغيرات اليومية
  // هذه محاكاة تقريبية، لكنها أفضل من لا شيء في حالة عدم وجود API خارجي
  let intraday1h = null;
  let intraday4h = null;
  if (series.length >= 20) {
    // نحاكي فريم 1 ساعة: نقسم اليوم إلى 24 جزء، ونأخذ عينات من السلسلة
    // طريقة بسيطة: نأخذ نقاط من السلسلة بفاصل 4 (تقريباً 6 ساعات لكل نقطة) للتشبيه بـ 4 ساعات
    const step1h = Math.floor(series.length / 24);
    const step4h = Math.floor(series.length / 6);
    if (step1h > 1) {
      const closes1h = [];
      for (let i = 0; i < series.length; i += step1h) {
        closes1h.push(series[i]);
      }
      if (closes1h.length > 10) {
        intraday1h = {
          close: closes1h[closes1h.length - 1],
          rsi14: calcRSIFromCloses(closes1h, 14),
          atr: calcATRFromCloses(closes1h, 14)
        };
      }
    }
    if (step4h > 1) {
      const closes4h = [];
      for (let i = 0; i < series.length; i += step4h) {
        closes4h.push(series[i]);
      }
      if (closes4h.length > 10) {
        intraday4h = {
          close: closes4h[closes4h.length - 1],
          rsi14: calcRSIFromCloses(closes4h, 14),
          atr: calcATRFromCloses(closes4h, 14)
        };
      }
    }
  }

  // الاحتمالات
  let probAboveSMA20 = null;
  let probAboveSMA50 = null;
  let probInBollinger7d = null;
  if (hv != null) {
    const T7 = 7 / 365;
    if (sma20Val != null) probAboveSMA20 = probabilityAbove(lastClose, sma20Val, T7, riskFreeRate, hv);
    if (sma50Val != null) probAboveSMA50 = probabilityAbove(lastClose, sma50Val, T7, riskFreeRate, hv);
    if (bb != null) probInBollinger7d = probabilityInRange(lastClose, bb.lower, bb.upper, 7, hv);
  }

  return {
    lastClose,
    sma20: sma20Val,
    sma50: sma50Val,
    rsi14,
    macd: macdVal,
    bollinger: bb,

    // Black-Scholes
    historicalVolatility: hv != null ? hv : null,
    expectedMove7d: hv != null ? expectedMove(lastClose, hv, 7) : null,
    expectedMove30d: hv != null ? expectedMove(lastClose, hv, 30) : null,
    expectedRange7d: hv != null ? expectedRange(lastClose, hv, 7, 0.68) : null,
    expectedRange7d95: hv != null ? expectedRange(lastClose, hv, 7, 0.95) : null,
    probAboveSMA20,
    probAboveSMA50,
    probInBollinger7d,

    // إضافات المتداول الجديدة
    atr: atrValue || atrFromSeries || null,
    pivot: pivotData,
    high5,
    low5,

    // بيانات الفريمات المحاكاة (أو يمكن جلبها من API خارجي)
    intraday1h,
    intraday4h,

    dataPoints: series.length,
    fromCache,
  };
}
