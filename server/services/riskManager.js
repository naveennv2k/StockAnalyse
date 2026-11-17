const RISK_PER_TRADE = 0.01;
const DAILY_MAX_LOSS = 0.03;

export function sizeForRisk({ capital, entry, stop, maxNotionalPct = 25 }) {
  const funds = Number(capital);
  const entryPrice = Number(entry);
  const stopPrice = Number(stop);
  const riskPerShare = Math.abs(entryPrice - stopPrice);
  if (![funds, entryPrice, stopPrice, riskPerShare].every(Number.isFinite) || funds <= 0 || entryPrice <= 0 || riskPerShare <= 0) return 0;
  const riskQuantity = Math.floor((funds * RISK_PER_TRADE) / riskPerShare);
  const exposureQuantity = Math.floor((funds * Number(maxNotionalPct)) / 100 / entryPrice);
  return Math.max(0, Math.min(riskQuantity, exposureQuantity));
}

export function dailyLossLimitHit({ capital, realizedPnl = 0, unrealizedPnl = 0 }) {
  const funds = Number(capital);
  if (!Number.isFinite(funds) || funds <= 0) return true;
  return Number(realizedPnl) + Number(unrealizedPnl) <= -(funds * DAILY_MAX_LOSS);
}

export const RISK_LIMITS = Object.freeze({ riskPerTrade: RISK_PER_TRADE, dailyMaxLoss: DAILY_MAX_LOSS });
