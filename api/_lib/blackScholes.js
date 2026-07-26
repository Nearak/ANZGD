// ============================================
// Black-Scholes + Probability Tools for XAUUSD
// ============================================

/** الدالة التجميعية للتوزيع الطبيعي (CDF) */
function normalCDF(x) {
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** الدالة الكثافية للتوزيع الطبيعي (PDF) */
function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** d1, d2 لصيغة Black-Scholes */
function d1d2(S, K, T, r, sigma) {
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return { d1, d2 };
}

/**
 * صيغة Black-Scholes الأساسية
 * type: 'call' | 'put'
 * ترجع: { price, delta, gamma, theta, vega, rho }
 */
export function blackScholes(S, K, T, r, sigma, type = "call") {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return null;
  const { d1, d2 } = d1d2(S, K, T, r, sigma);
  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const Nmd1 = normalCDF(-d1);
  const Nmd2 = normalCDF(-d2);

  let price, delta, gamma, theta, vega, rho;

  if (type === "call") {
    price = S * Nd1 - K * Math.exp(-r * T) * Nd2;
    delta = Nd1;
    rho   = K * T * Math.exp(-r * T) * Nd2 / 100;
  } else {
    price = K * Math.exp(-r * T) * Nmd2 - S * Nmd1;
    delta = -Nmd1;
    rho   = -K * T * Math.exp(-r * T) * Nmd2 / 100;
  }

  gamma = normalPDF(d1) / (S * sigma * Math.sqrt(T));
  theta = -(S * normalPDF(d1) * sigma) / (2 * Math.sqrt(T));
  theta -= r * K * Math.exp(-r * T) * (type === "call" ? Nd2 : -Nmd2);
  theta /= 365; // يومياً
  vega  = S * normalPDF(d1) * Math.sqrt(T) / 100;

  return { price, delta, gamma, theta, vega, rho };
}

/** الحركة المتوقعة بناءً على التقلب */
export function expectedMove(S, sigma, days) {
  const T = days / 365;
  return S * sigma * Math.sqrt(T);
}

/** احتمالية أن يكون السعر أعلى من K بعد T */
export function probabilityAbove(S, K, T, r, sigma) {
  if (T <= 0) return S > K ? 1 : 0;
  const { d2 } = d1d2(S, K, T, r, sigma);
  return normalCDF(d2);
}

/** احتمالية أن يكون السعر أقل من K بعد T */
export function probabilityBelow(S, K, T, r, sigma) {
  return 1 - probabilityAbove(S, K, T, r, sigma);
}

/** احتمالية "اللمس" (Probability of Touch) — مفيد جداً لتحديد Stop Loss */
export function probabilityOfTouch(S, K, T, r, sigma) {
  if (S === K) return 1;
  const prob = probabilityAbove(S, K, T, r, sigma);
  const ratio = Math.log(K / S);
  const factor = 2 * (r / (sigma * sigma) - 0.5);
  return prob + Math.exp(factor * ratio) * (S > K ? probabilityBelow(S, K, T, r, sigma) : probabilityAbove(S, K, T, r, sigma));
}

/** حساب التقلب التاريخي من سلسلة أسعار يومية */
export function historicalVolatility(closes) {
  if (!closes || closes.length < 2) return null;
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
  const dailyVol = Math.sqrt(variance);
  return dailyVol * Math.sqrt(252); // سنوي
}

/** نطاق التداول المتوقع (Expected Range) */
export function expectedRange(S, sigma, days, confidence = 0.68) {
  const z = confidence === 0.68 ? 1 : confidence === 0.95 ? 1.96 : 2.58;
  const move = expectedMove(S, sigma, days) * z;
  return { lower: S - move, upper: S + move, width: move * 2 };
}

/** احتمالية البقاء ضمن نطاق (Range Probability) */
export function probabilityInRange(S, lower, upper, days, sigma) {
  const T = days / 365;
  const r = 0.045;
  const pBelowLower = probabilityBelow(S, lower, T, r, sigma);
  const pAboveUpper = probabilityAbove(S, upper, T, r, sigma);
  return 1 - pBelowLower - pAboveUpper;
}
