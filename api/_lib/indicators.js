// دوال حساب مؤشرات التحليل الفني الكلاسيكية من سلسلة أسعار يومية (الأقدم أولاً).

export function sma(values, period) {
  if (!values || values.length < period) return null;
  const slice = values.slice(values.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function emaSeries(values, period) {
  if (!values || values.length < period) return [];
  const k = 2 / (period + 1);
  const emaArr = new Array(values.length).fill(null);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  emaArr[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    emaArr[i] = prev;
  }
  return emaArr;
}

export function rsi(values, period = 14) {
  if (!values || values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  if (!values || values.length < slow + signalPeriod) return null;
  const emaFast = emaSeries(values, fast);
  const emaSlow = emaSeries(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  const macdValues = macdLine.filter((v) => v != null);
  if (macdValues.length < signalPeriod) return null;
  const signalArr = emaSeries(macdValues, signalPeriod);
  const macdVal = macdValues[macdValues.length - 1];
  const signalVal = signalArr[signalArr.length - 1];
  if (macdVal == null || signalVal == null) return null;
  return { macd: macdVal, signal: signalVal, histogram: macdVal - signalVal };
}

export function bollinger(values, period = 20, mult = 2) {
  if (!values || values.length < period) return null;
  const slice = values.slice(values.length - period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + mult * sd, mid: mean, lower: mean - mult * sd };
}
