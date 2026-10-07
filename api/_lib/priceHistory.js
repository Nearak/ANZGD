// بيانات يومية للذهب + مؤشرات فنية مشتقة منها.
// مهم: هذه الوحدة لا تصف أي بيانات مشتقة على أنها 1H/4H ما لم تكن لدينا بيانات intraday حقيقية.

import { sma, rsi, macd, bollinger } from "./indicators.js";
import {
  historicalVolatility,
  expectedMove,
  expectedRange,
  probabilityAbove,
  probabilityInRange
} from "./blackScholes.js";

const CACHE_TTL_MINUTES = 45;
const CACHE_KEY = "xau_daily_series";

async function getCache() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) return null;

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/market_cache?key=eq.${CACHE_KEY}&select=value,updated_at`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`
        }
      }
    );

    if (!r.ok) return null;

    const rows = await r.json();
    return rows?.[0] || null;
  } catch {
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
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        key: CACHE_KEY,
        value,
        updated_at: new Date().toISOString()
      })
    });
  } catch {}
}

async function fetchFreshDailySeries() {
  const apiKey = process.env.GOLD_API_KEY;
  if (!apiKey) return null;

  const end = Math.floor(Date.now() / 1000);
  const start = end - 120 * 24 * 60 * 60;

  const url =
    `https://api.gold-api.com/history?symbol=XAU` +
    `&startTimestamp=${start}` +
    `&endTimestamp=${end}` +
    `&groupBy=day` +
    `&aggregation=avg` +
    `&orderBy=asc`;

  try {
    const r = await fetch(url, {
      headers: {
        "x-api-key": apiKey
      }
    });

    if (!r.ok) return null;

    const rows = await r.json();

    return rows
      .map(row => Number(row.avg_price))
      .filter(v => Number.isFinite(v) && v > 0);
  } catch {
    return null;
  }
}

function pctChange(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) {
    return null;
  }

  return ((a - b) / b) * 100;
}

function avgAbsMove(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;

  const diffs = [];

  for (let i = closes.length - period; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];

    if (Number.isFinite(prev) && Number.isFinite(cur)) {
      diffs.push(Math.abs(cur - prev));
    }
  }

  return diffs.length
    ? diffs.reduce((a, b) => a + b, 0) / diffs.length
    : null;
}

function rollingVolatility(closes, lookback = 20) {
  if (!closes || closes.length < lookback + 1) return null;

  return historicalVolatility(
    closes.slice(-(lookback + 1))
  );
}

function rangeLevels(series) {
  if (!series || series.length < 5) return null;

  const last5 = series.slice(-5);
  const last20 = series.slice(-Math.min(20, series.length));

  const high5 = Math.max(...last5);
  const low5 = Math.min(...last5);

  const high20 = Math.max(...last20);
  const low20 = Math.min(...last20);

  return {
    high5,
    low5,
    midpoint5: (high5 + low5) / 2,

    high20,
    low20,
    midpoint20: (high20 + low20) / 2
  };
}

function classifyMarketRegime({
  lastClose,
  sma20Val,
  sma50Val,
  rsi14,
  macdVal,
  bb,
  hv20,
  hvFull
}) {
  let trendScore = 0;

  if (sma20Val != null) {
    trendScore += lastClose > sma20Val ? 1 : -1;
  }

  if (sma20Val != null && sma50Val != null) {
    trendScore += sma20Val > sma50Val ? 1 : -1;
  }

  if (macdVal?.histogram != null) {
    trendScore +=
      macdVal.histogram > 0
        ? 1
        : macdVal.histogram < 0
        ? -1
        : 0;
  }

  if (rsi14 != null) {
    if (rsi14 >= 55) trendScore += 1;
    else if (rsi14 <= 45) trendScore -= 1;
  }

  const volRatio =
    hv20 && hvFull
      ? hv20 / hvFull
      : null;

  const highVolatility =
    volRatio != null
      ? volRatio >= 1.25
      : false;

  const bbWidthPct =
    bb && lastClose
      ? ((bb.upper - bb.lower) / lastClose) * 100
      : null;

  let type = "range";

  if (Math.abs(trendScore) >= 3) {
    type =
      trendScore > 0
        ? "bull_trend"
        : "bear_trend";
  } else if (Math.abs(trendScore) === 2) {
    type =
      trendScore > 0
        ? "bull_bias"
        : "bear_bias";
  }

  if (highVolatility) {
    type += "_high_vol";
  }

  return {
    type,
    trendScore,
    highVolatility,
    volatilityRatio: volRatio,
    bollingerWidthPct: bbWidthPct
  };
}

function technicalConfluence({
  lastClose,
  sma20Val,
  sma50Val,
  rsi14,
  macdVal,
  bb,
  momentum5d,
  momentum20d
}) {
  const factors = [];

  const add = (name, score, reason) => {
    factors.push({
      name,
      score,
      reason
    });
  };

  if (sma20Val != null) {
    add(
      "price_vs_sma20",
      lastClose > sma20Val ? 12 : -12,
      lastClose > sma20Val
        ? "السعر فوق SMA20"
        : "السعر تحت SMA20"
    );
  }

  if (sma20Val != null && sma50Val != null) {
    add(
      "sma_structure",
      sma20Val > sma50Val ? 14 : -14,
      sma20Val > sma50Val
        ? "SMA20 فوق SMA50"
        : "SMA20 تحت SMA50"
    );
  }

  if (macdVal?.histogram != null) {
    add(
      "macd",
      macdVal.histogram > 0 ? 12 : -12,
      macdVal.histogram > 0
        ? "MACD إيجابي"
        : "MACD سلبي"
    );
  }

  if (rsi14 != null) {
    const score =
      rsi14 >= 55 && rsi14 <= 70
        ? 10
        : rsi14 > 70
        ? 4
        : rsi14 <= 45 && rsi14 >= 30
        ? -10
        : rsi14 < 30
        ? -4
        : 0;

    add(
      "rsi",
      score,
      `RSI14 = ${rsi14.toFixed(1)}`
    );
  }

  if (momentum5d != null) {
    add(
      "momentum5d",
      momentum5d > 0
        ? 8
        : momentum5d < 0
        ? -8
        : 0,
      `زخم 5 أيام ${momentum5d.toFixed(2)}%`
    );
  }

  if (momentum20d != null) {
    add(
      "momentum20d",
      momentum20d > 0
        ? 8
        : momentum20d < 0
        ? -8
        : 0,
      `زخم 20 يوم ${momentum20d.toFixed(2)}%`
    );
  }

  if (bb) {
    let score = 0;

    if (lastClose > bb.mid) score += 6;
    else score -= 6;

    if (lastClose >= bb.upper) score -= 3;

    if (lastClose <= bb.lower) score += 3;

    add(
      "bollinger",
      score,
      `الموقع داخل بولينجر بالنسبة للمنتصف ${
        lastClose > bb.mid
          ? "إيجابي"
          : "سلبي"
      }`
    );
  }

  const raw =
    factors.reduce(
      (sum, factor) => sum + factor.score,
      0
    );

  const maxAbs =
    factors.reduce(
      (sum, factor) =>
        sum + Math.abs(factor.score),
      0
    ) || 1;

  const normalized =
    Math.round(
      (raw / maxAbs) * 100
    );

  const direction =
    normalized >= 25
      ? "bullish"
      : normalized <= -25
      ? "bearish"
      : "neutral";

  return {
    score: normalized,
    direction,
    factors
  };
}

export async function getTechnicalSnapshot() {
  const cached = await getCache();

  let series = null;
  let fromCache = false;

  if (cached?.updated_at) {
    const ageMinutes =
      (
        Date.now() -
        new Date(cached.updated_at).getTime()
      ) / 60000;

    if (
      ageMinutes < CACHE_TTL_MINUTES &&
      Array.isArray(cached.value)
    ) {
      series = cached.value;
      fromCache = true;
    }
  }

  if (!series) {
    series = await fetchFreshDailySeries();

    if (series?.length) {
      await setCache(series);
    } else if (
      cached &&
      Array.isArray(cached.value)
    ) {
      series = cached.value;
      fromCache = true;
    }
  }

  if (!series || series.length < 15) {
    return null;
  }

  const lastClose = series.at(-1);

  const hv =
    historicalVolatility(series);

  const hv20 =
    rollingVolatility(series, 20);

  const riskFreeRate = 0.045;

  const sma20Val =
    series.length >= 20
      ? sma(series, 20)
      : null;

  const sma50Val =
    series.length >= 50
      ? sma(series, 50)
      : null;

  const bb =
    series.length >= 20
      ? bollinger(series, 20, 2)
      : null;

  const rsi14 =
    rsi(series, 14);

  const macdVal =
    series.length >= 35
      ? macd(series)
      : null;

  const levels =
    rangeLevels(series);

  const move14 =
    avgAbsMove(series, 14);

  const momentum5d =
    series.length >= 6
      ? pctChange(
          lastClose,
          series.at(-6)
        )
      : null;

  const momentum20d =
    series.length >= 21
      ? pctChange(
          lastClose,
          series.at(-21)
        )
      : null;

  const distanceFromSma20Pct =
    sma20Val
      ? pctChange(
          lastClose,
          sma20Val
        )
      : null;

  const distanceFromSma50Pct =
    sma50Val
      ? pctChange(
          lastClose,
          sma50Val
        )
      : null;

  const marketRegime =
    classifyMarketRegime({
      lastClose,
      sma20Val,
      sma50Val,
      rsi14,
      macdVal,
      bb,
      hv20,
      hvFull: hv
    });

  const confluence =
    technicalConfluence({
      lastClose,
      sma20Val,
      sma50Val,
      rsi14,
      macdVal,
      bb,
      momentum5d,
      momentum20d
    });

  let probAboveSMA20 = null;
  let probAboveSMA50 = null;
  let probInBollinger7d = null;

  if (hv != null) {
    const T7 = 7 / 365;

    if (sma20Val != null) {
      probAboveSMA20 =
        probabilityAbove(
          lastClose,
          sma20Val,
          T7,
          riskFreeRate,
          hv
        );
    }

    if (sma50Val != null) {
      probAboveSMA50 =
        probabilityAbove(
          lastClose,
          sma50Val,
          T7,
          riskFreeRate,
          hv
        );
    }

    if (bb != null) {
      probInBollinger7d =
        probabilityInRange(
          lastClose,
          bb.lower,
          bb.upper,
          7,
          hv
        );
    }
  }

  return {
    lastClose,

    sma20: sma20Val,
    sma50: sma50Val,

    rsi14,
    macd: macdVal,
    bollinger: bb,

    momentum5d,
    momentum20d,

    distanceFromSma20Pct,
    distanceFromSma50Pct,

    historicalVolatility: hv,
    recentVolatility20d: hv20,

    expectedMove7d:
      hv != null
        ? expectedMove(
            lastClose,
            hv,
            7
          )
        : null,

    expectedMove30d:
      hv != null
        ? expectedMove(
            lastClose,
            hv,
            30
          )
        : null,

    expectedRange7d:
      hv != null
        ? expectedRange(
            lastClose,
            hv,
            7,
            0.68
          )
        : null,

    expectedRange7d95:
      hv != null
        ? expectedRange(
            lastClose,
            hv,
            7,
            0.95
          )
        : null,

    probAboveSMA20,
    probAboveSMA50,
    probInBollinger7d,

    avgAbsDailyMove14: move14,

    rangeLevels: levels,

    marketRegime,

    technicalConfluence:
      confluence,

    intradayAvailable: false,

    dataPoints: series.length,

    fromCache
  };
}
