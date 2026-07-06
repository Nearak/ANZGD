// يجيب سلسلة أسعار يومية للذهب (آخر ~90 يوم) من gold-api.com، مع تخزين مؤقت (Cache)
// بجدول market_cache بقاعدة بيانات Supabase — لأن endpoint البيانات التاريخية محدود
// بـ10 طلبات بالساعة، وبكذا كل المشتركين بيستفيدوا من نفس النسخة المخزنة مؤقتاً.

import { sma, rsi, macd, bollinger } from "./indicators.js";

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
    return rows.map((row) => row.avg_price).filter((v) => typeof v === "number");
  } catch (e) {
    return null;
  }
}

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
      series = cached.value; // احتياطي: استخدم آخر نسخة محفوظة لو فشل الجلب الجديد
      fromCache = true;
    }
  }

  if (!series || series.length < 20) return null;

  return {
    lastClose: series[series.length - 1],
    sma20: sma(series, 20),
    sma50: series.length >= 50 ? sma(series, 50) : null,
    rsi14: rsi(series, 14),
    macd: macd(series),
    bollinger: bollinger(series, 20, 2),
    dataPoints: series.length,
    fromCache,
  };
}
