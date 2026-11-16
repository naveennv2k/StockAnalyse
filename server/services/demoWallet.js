import { getDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';

const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function estimateEquityCharges({ exchange = 'NSE', side, productType = 'MIS', turnover }) {
  const isBuy = String(side).toUpperCase() === 'BUY';
  const delivery = ['C', 'CNC', 'DELIVERY'].includes(String(productType).toUpperCase());
  const value = Math.abs(Number(turnover) || 0);
  const brokerage = 0;
  const stt = money(value * (delivery ? 0.001 : (!isBuy ? 0.00025 : 0)));
  const exchangeRate = String(exchange).toUpperCase() === 'BSE' ? 0.0000375 : 0.0000307;
  const exchangeCharges = money(value * exchangeRate);
  const sebiCharges = money(value * 0.000001);
  const ipftCharges = money(value * 0.000001);
  const gst = money((brokerage + exchangeCharges + sebiCharges) * 0.18);
  const stampDuty = money(value * (isBuy ? (delivery ? 0.00015 : 0.00003) : 0));
  const total = money(brokerage + stt + exchangeCharges + sebiCharges + ipftCharges + gst + stampDuty);
  return { brokerage, stt, exchange_charges: exchangeCharges, sebi_charges: sebiCharges, ipft_charges: ipftCharges, gst, stamp_duty: stampDuty, total };
}

/**
 * Demo Wallet — Paper Trading Engine
 * Simulates order execution with a virtual ₹10L balance.
 */

export class DemoWallet {
  constructor() {
    this.db = getDb();
  }

  // ── Wallet Info ──
  getWallet() {
    const wallet = this.db.prepare('SELECT * FROM wallet WHERE id = 1').get();
    const positions = this.getPositions();
    const invested = positions.reduce((sum, p) => sum + (p.avg_price * p.quantity), 0);
    const currentValue = positions.reduce((sum, p) => sum + (p.current_price * p.quantity), 0);
    const unrealizedPnl = positions.reduce((sum, p) => sum + ((p.current_price - p.avg_price) * p.quantity) - (p.open_charges || 0), 0);

    return {
      ...wallet,
      invested: Math.round(invested * 100) / 100,
      current_value: Math.round(currentValue * 100) / 100,
      unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
      total_value: Math.round((wallet.cash_balance + currentValue) * 100) / 100,
    };
  }

  resetWallet(startingBalance = 1000000) {
    this.db.prepare(`UPDATE wallet SET starting_balance = ?, cash_balance = ?, updated_at = datetime('now') WHERE id = 1`)
      .run(startingBalance, startingBalance);
    this.db.prepare(`DELETE FROM positions WHERE trading_mode = 'demo'`).run();
    this.db.prepare(`DELETE FROM trades WHERE trading_mode = 'demo'`).run();
    this.db.prepare('DELETE FROM lessons').run();
    return this.getWallet();
  }

  updateWalletBalance(amount) {
    this.db.prepare(`UPDATE wallet SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = 1`)
      .run(amount);
  }

  // ── Place Order (Demo) ──
  placeOrder({ symbol, exchange = 'NSE', side, quantity, price, orderType = 'MARKET', productType = 'MIS', remarks = '', agentVerdict = '', agentConfidence = 0, allowShort = false, stopLoss = null, target = null, decisionId = null }) {
    const wallet = this.getWallet();

    if (!symbol || !side || !quantity || quantity <= 0) {
      return { success: false, error: 'Invalid order parameters' };
    }
    if (!['BUY', 'SELL'].includes(side.toUpperCase())) {
      return { success: false, error: 'Side must be BUY or SELL' };
    }
    side = side.toUpperCase();

    const totalCost = price * quantity;
    const charges = estimateEquityCharges({ exchange, side, productType, turnover: totalCost });
    const position = this.db.prepare(
      `SELECT * FROM positions WHERE symbol = ? AND exchange = ? AND product_type = ? AND trading_mode = 'demo'`
    ).get(symbol, exchange, productType);
    const curQty = position?.quantity || 0;

    if (side === 'BUY' && totalCost + charges.total > wallet.cash_balance) {
      return { success: false, error: `Insufficient funds. Need ₹${(totalCost + charges.total).toFixed(2)} including estimated charges, have ₹${wallet.cash_balance.toFixed(2)}` };
    }
    if (side === 'SELL' && curQty < quantity && !allowShort) {
      return { success: false, error: `Insufficient quantity. Have ${Math.max(curQty, 0)}, trying to sell ${quantity}` };
    }

    const tradeId = uuidv4();
    const fillPrice = price;
    const fillTime = new Date().toISOString();
    const signedQty = side === 'BUY' ? quantity : -quantity;
    const newQty = curQty + signedQty;

    // Realized P&L only on the part that closes an existing position
    let grossRealized = 0;
    let realized = 0;
    let openCharges = position?.open_charges || 0;
    if (curQty !== 0 && Math.sign(curQty) !== Math.sign(signedQty)) {
      const closing = Math.min(Math.abs(curQty), quantity);
      grossRealized = (fillPrice - position.avg_price) * closing * Math.sign(curQty);
      const allocatedEntryCharges = (position.open_charges || 0) * closing / Math.abs(curQty);
      const allocatedExitCharges = charges.total * closing / quantity;
      realized = grossRealized - allocatedEntryCharges - allocatedExitCharges;
      openCharges = Math.max(0, (position.open_charges || 0) - allocatedEntryCharges);
      if (newQty !== 0 && Math.sign(newQty) !== Math.sign(curQty)) {
        openCharges += charges.total * Math.abs(newQty) / quantity;
      }
    } else {
      openCharges += charges.total;
    }

    const apply = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO trades (id, symbol, exchange, side, quantity, price, order_type, product_type, status, fill_price, fill_time, trading_mode, remarks, agent_verdict, agent_confidence, realized_pnl, gross_realized_pnl, charges, charge_breakdown)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FILLED', ?, ?, 'demo', ?, ?, ?, ?, ?, ?, ?)
      `).run(tradeId, symbol, exchange, side, quantity, price, orderType, productType, fillPrice, fillTime, remarks, agentVerdict, agentConfidence, realized, grossRealized, charges.total, JSON.stringify(charges));

      if (newQty === 0) {
        this.db.prepare('DELETE FROM positions WHERE id = ?').run(position.id);
      } else if (!position) {
        this.db.prepare(
          `INSERT INTO positions (symbol, exchange, quantity, avg_price, current_price, product_type, trading_mode, stop_loss, target, decision_id, open_charges) VALUES (?, ?, ?, ?, ?, ?, 'demo', ?, ?, ?, ?)`
        ).run(symbol, exchange, newQty, fillPrice, fillPrice, productType, stopLoss, target, decisionId, openCharges);
      } else {
        const sameDirection = Math.sign(curQty) === Math.sign(signedQty);
        const flipped = !sameDirection && Math.sign(newQty) !== Math.sign(curQty);
        let avg = position.avg_price;
        if (sameDirection) avg = (position.avg_price * Math.abs(curQty) + fillPrice * quantity) / Math.abs(newQty);
        else if (flipped) avg = fillPrice;
        this.db.prepare(
          `UPDATE positions SET quantity = ?, avg_price = ?, current_price = ?, pnl = (? - ?) * ? - ?, open_charges = ?, stop_loss = ?, target = ?, decision_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(newQty, Math.round(avg * 100) / 100, fillPrice, fillPrice, avg, newQty, openCharges, openCharges,
          !flipped && stopLoss == null ? position.stop_loss : stopLoss,
          !flipped && target == null ? position.target : target,
          !flipped && decisionId == null ? position.decision_id : decisionId,
          position.id);
      }
      this.updateWalletBalance(side === 'BUY' ? -(totalCost + charges.total) : totalCost - charges.total);
    });
    apply();

    this._logAgent('order_placer', `${side} ${quantity}x ${symbol} @ ₹${fillPrice}`, 'success');

    return {
      success: true,
      trade: { id: tradeId, symbol, exchange, side, quantity, fill_price: fillPrice, fill_time: fillTime, total_value: totalCost, charges, gross_realized_pnl: grossRealized, realized_pnl: realized },
    };
  }

  // ── Position Management ──
  getPositions() {
    return this.db.prepare(`SELECT * FROM positions WHERE trading_mode = 'demo' AND quantity != 0`).all();
  }

  updatePositionPrices(priceMap) {
    const update = this.db.prepare(
      `UPDATE positions SET current_price = ?, pnl = (? - avg_price) * quantity - open_charges, updated_at = datetime('now') WHERE symbol = ? AND trading_mode = 'demo'`
    );
    const updateMany = this.db.transaction((prices) => {
      for (const [symbol, price] of Object.entries(prices)) {
        update.run(price, price, symbol);
      }
    });
    updateMany(priceMap);
  }

  // ── Trade History ──
  getTradeHistory(limit = 50) {
    return this.db.prepare(
      `SELECT * FROM trades WHERE trading_mode = 'demo' ORDER BY created_at DESC LIMIT ?`
    ).all(limit);
  }

  getTradeStats() {
    const trades = this.db.prepare(
      `SELECT * FROM trades WHERE trading_mode = 'demo' AND status = 'FILLED'`
    ).all();

    const totalTrades = trades.length;
    const buyTrades = trades.filter(t => t.side === 'BUY').length;
    const sellTrades = trades.filter(t => t.side === 'SELL').length;
    const chargedTrades = trades.filter((t) => {
      try { return Object.keys(JSON.parse(t.charge_breakdown || '{}')).length > 0; } catch { return false; }
    }).length;

    return {
      total_trades: totalTrades,
      buy_trades: buyTrades,
      sell_trades: sellTrades,
      realized_pnl: Math.round(trades.reduce((s, t) => s + (t.realized_pnl || 0), 0) * 100) / 100,
      gross_realized_pnl: Math.round(trades.reduce((s, t) => s + (t.gross_realized_pnl || 0), 0) * 100) / 100,
      total_charges: Math.round(trades.reduce((s, t) => s + (t.charges || 0), 0) * 100) / 100,
      charged_trades: chargedTrades,
      unpriced_trades: totalTrades - chargedTrades,
    };
  }

  // ── Watchlist ──
  getWatchlist() {
    return this.db.prepare('SELECT * FROM watchlist ORDER BY added_at DESC').all();
  }

  addToWatchlist(symbol, exchange = 'NSE') {
    try {
      this.db.prepare('INSERT INTO watchlist (symbol, exchange) VALUES (?, ?)').run(symbol.toUpperCase(), exchange);
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Symbol already in watchlist' };
    }
  }

  removeFromWatchlist(symbol) {
    this.db.prepare('DELETE FROM watchlist WHERE symbol = ?').run(symbol.toUpperCase());
    return { success: true };
  }

  // ── Lessons (Correction Agent) ──
  addLesson({ tradeId, symbol, lessonType, whatHappened, whyItFailed, ruleLearned, severity = 'medium' }) {
    this.db.prepare(`
      INSERT INTO lessons (trade_id, symbol, lesson_type, what_happened, why_it_failed, rule_learned, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tradeId, symbol, lessonType, whatHappened, whyItFailed, ruleLearned, severity);
  }

  getLessons(limit = 20) {
    return this.db.prepare('SELECT * FROM lessons ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  // ── Agent Logs ──
  _logAgent(agentName, action, status = 'info', details = '') {
    this.db.prepare(
      'INSERT INTO agent_logs (agent_name, action, details, status) VALUES (?, ?, ?, ?)'
    ).run(agentName, action, details, status);
  }

  getAgentLogs(limit = 50) {
    return this.db.prepare('SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?').all(limit);
  }
}

export default DemoWallet;
