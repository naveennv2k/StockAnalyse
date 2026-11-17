import { useState, useEffect, useCallback, useRef } from 'react';
import { getPositions, getTrades, getWallet, getFlattradeOrders, placeOrder } from '../services/api';
import { RefreshCw, TrendingUp, TrendingDown, ArrowUpDown } from 'lucide-react';

const fmt = (v) => v != null ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

export default function Positions() {
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState({});
  const [wallet, setWallet] = useState({});
  const [liveAccount, setLiveAccount] = useState(null);
  const [tab, setTab] = useState('positions');
  const [loading, setLoading] = useState(true);
  const [orderBusy, setOrderBusy] = useState(false);
  const orderInFlight = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      const [posRes, walletRes] = await Promise.all([getPositions(), getWallet()]);
      setPositions(posRes.positions || []);
      setWallet(walletRes);
      if (walletRes.trading_mode === 'live') {
        const orderRes = await getFlattradeOrders();
        setLiveAccount(posRes.account ? { ...posRes.account, connected: posRes.connected, error: posRes.error } : { connected: false, error: posRes.error || 'Flattrade account unavailable' });
        setTrades(orderRes.orders || []);
        setStats({});
      } else {
        const tradeRes = await getTrades(100);
        setLiveAccount(null);
        setTrades(tradeRes.trades || []);
        setStats(tradeRes.stats || {});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handlePositionOrder = async (position, side) => {
    if (orderInFlight.current) return;
    const symbol = String(position.symbol || '').replace(/-(EQ|BE|BZ)$/, '');
    const defaultQuantity = Math.abs(Number(position.quantity)) || 1;
    const entered = prompt(`${side} ${symbol}\nEnter quantity:`, String(defaultQuantity));
    if (entered == null) return;
    const quantity = Number(entered);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) {
      alert('Quantity must be a whole number between 1 and 100000.');
      return;
    }

    const live = wallet.trading_mode === 'live';
    if (live && !window.confirm(`LIVE ORDER: Submit a MARKET ${side} order for ${quantity} ${symbol} on ${position.exchange || 'NSE'}?\n\nThis sends a real order to Flattrade and may execute immediately. The displayed price is only a reference, not a guaranteed fill price.`)) return;

    orderInFlight.current = true;
    setOrderBusy(true);
    try {
      const result = await placeOrder({
        symbol,
        exchange: position.exchange || 'NSE',
        side,
        quantity,
        price: Number(position.current_price) || undefined,
        orderType: 'MARKET',
        productType: 'MIS',
        ...(live ? { liveConfirmed: true } : {}),
      });
      alert(live
        ? `Flattrade accepted order ${result.order_number}: ${side} ${quantity} ${result.symbol}. Check the broker order book for fill status.`
        : `${side} order placed: ${quantity} ${symbol} at ₹${Number(position.current_price || 0).toFixed(2)}.`);
      await fetchData();
    } catch (err) {
      alert(err.message);
    } finally {
      orderInFlight.current = false;
      setOrderBusy(false);
    }
  };

  const submitExits = async (items, live) => {
    if (orderInFlight.current || !items.length) return;
    orderInFlight.current = true;
    setOrderBusy(true);
    const accepted = [];
    const failed = [];
    try {
      for (const { position, side, quantity } of items) {
        const symbol = String(position.symbol || '').replace(/-(EQ|BE|BZ)$/, '');
        try {
          const result = await placeOrder({
            symbol,
            exchange: position.exchange || 'NSE',
            side,
            quantity,
            price: Number(position.current_price) || undefined,
            orderType: 'MARKET',
            productType: 'MIS',
            ...(live ? { liveConfirmed: true } : {}),
          });
          accepted.push(live ? `${symbol} (${result.order_number})` : symbol);
        } catch (err) {
          failed.push(`${symbol}: ${err.message}`);
        }
      }
      await fetchData();
      const message = live
        ? `${accepted.length} Flattrade exits accepted; check the broker order book for fills.`
        : `${accepted.length} positions exited in the demo wallet.`;
      alert([message, ...failed].join('\n'));
    } finally {
      orderInFlight.current = false;
      setOrderBusy(false);
    }
  };

  const handleExitPosition = (position) => {
    const quantity = Math.abs(Number(position.quantity));
    if (!Number.isSafeInteger(quantity) || quantity < 1) return;
    const symbol = String(position.symbol || '').replace(/-(EQ|BE|BZ)$/, '');
    const side = Number(position.quantity) > 0 ? 'SELL' : 'BUY';
    const live = wallet.trading_mode === 'live';
    const promptText = live
      ? `LIVE EXIT: Submit a MARKET ${side} order for all ${quantity} ${symbol} on ${position.exchange || 'NSE'}? This sends a real Flattrade order.`
      : `Exit all ${quantity} ${symbol} shares with a market ${side} order?`;
    if (window.confirm(promptText)) submitExits([{ position, side, quantity }], live);
  };

  const handleExitAll = () => {
    const items = positions.map((position) => ({
      position,
      side: Number(position.quantity) > 0 ? 'SELL' : 'BUY',
      quantity: Math.abs(Number(position.quantity)),
    })).filter((item) => Number.isSafeInteger(item.quantity) && item.quantity > 0);
    if (!items.length) return;
    const live = wallet.trading_mode === 'live';
    const symbols = items.slice(0, 8).map(({ position }) => position.symbol).join(', ');
    const more = items.length > 8 ? `, and ${items.length - 8} more` : '';
    const promptText = live
      ? `LIVE EXIT ALL: Submit ${items.length} real Flattrade market orders to close these positions: ${symbols}${more}? This is not atomic; some orders may succeed while others fail.`
      : `Exit all ${items.length} open demo positions with market orders?`;
    if (window.confirm(promptText)) submitExits(items, live);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-blue-500" size={32} /></div>;

  const totalInvested = positions.reduce((s, p) => s + p.avg_price * p.quantity, 0);
  const totalCurrent = positions.reduce((s, p) => s + p.current_price * p.quantity, 0);
  const totalPnl = wallet.unrealized_pnl ?? (totalCurrent - totalInvested);
  const liveMode = wallet.trading_mode === 'live';
  const livePositionPnl = (liveAccount?.positions || []).reduce((sum, position) => sum + (Number(position.pnl) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {liveMode ? (
        <>
          {!liveAccount?.connected && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Flattrade account details are unavailable: {liveAccount?.error || 'reconnect on Integrations'}.</p>}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <SummaryCard label="Flattrade Cash" value={`₹${fmt(liveAccount?.cash)}`} />
            <SummaryCard label="Available Pay-in" value={`₹${fmt(liveAccount?.payin)}`} />
            <SummaryCard label="Margin Used" value={`₹${fmt(liveAccount?.margin_used)}`} />
            <SummaryCard label="Broker Position P&L" value={`₹${fmt(livePositionPnl)}`} positive={livePositionPnl >= 0} />
            <SummaryCard label="Holdings" value={(liveAccount?.holdings || []).length} />
          </div>
          <p className="-mt-4 text-xs text-slate-400">Live balances and P&amp;L are from Flattrade’s account/position response. The Demo wallet is not shown in Live mode.</p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-7 gap-4">
            <SummaryCard label="Cash Balance" value={`₹${fmt(wallet.cash_balance)}`} />
            <SummaryCard label="Invested" value={`₹${fmt(totalInvested)}`} />
            <SummaryCard label="Current Value" value={`₹${fmt(totalCurrent)}`} />
            <SummaryCard label="Unrealized P&L" value={`₹${fmt(totalPnl)}`} positive={totalPnl >= 0} />
            <SummaryCard label="Realized P&L (net)" value={`₹${fmt(stats.realized_pnl)}`} positive={(stats.realized_pnl || 0) >= 0} />
            <SummaryCard label={stats.unpriced_trades ? 'Fees recorded*' : 'Fees paid'} value={`₹${fmt(stats.total_charges)}`} />
            <SummaryCard label="Total Trades" value={stats.total_trades || 0} />
          </div>
          {stats.unpriced_trades > 0 && <p className="-mt-4 text-xs text-slate-400">*Fee estimates are recorded for {stats.charged_trades} trades. {stats.unpriced_trades} older trades have no fee breakdown; their displayed P&amp;L is gross.</p>}
        </>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="border-b border-slate-100 px-4 flex gap-0">
          {[
            { id: 'positions', label: `📊 Open Positions (${positions.length})` },
            { id: 'trades', label: `📑 ${liveMode ? 'Flattrade Order Book' : 'Trade History'} (${trades.length})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition ${tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {tab === 'positions' && positions.length > 0 && (
              <button disabled={orderBusy} onClick={handleExitAll}
                className="border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-700 rounded px-3 py-1.5 text-xs font-semibold">
                {orderBusy ? 'Submitting...' : `Exit All (${positions.length})`}
              </button>
            )}
            <button onClick={fetchData} className="text-slate-400 hover:text-slate-600 p-2"><RefreshCw size={16} /></button>
          </div>
        </div>

        {tab === 'positions' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase">
                  <th className="px-4 py-2.5">Symbol</th>
                  <th className="px-4 py-2.5 text-right">Qty</th>
                  <th className="px-4 py-2.5 text-right">Avg Price</th>
                  <th className="px-4 py-2.5 text-right">Current</th>
                  <th className="px-4 py-2.5 text-right">Invested</th>
                  <th className="px-4 py-2.5 text-right">Current Value</th>
                  <th className="px-4 py-2.5 text-right">P&L</th>
                  <th className="px-4 py-2.5 text-right">P&L %</th>
                  <th className="px-4 py-2.5 text-center">Type</th>
                  <th className="px-4 py-2.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => {
                  const invested = p.avg_price * p.quantity;
                  const current = p.current_price * p.quantity;
                  const pnl = p.pnl ?? (current - invested);
                  const pnlPct = invested !== 0 ? (pnl / Math.abs(invested)) * 100 : 0;
                  const isUp = pnl >= 0;
                  return (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-semibold text-slate-800">{p.symbol}</td>
                      <td className="px-4 py-3 text-right font-mono">{p.quantity}</td>
                      <td className="px-4 py-3 text-right font-mono">₹{fmt(p.avg_price)}</td>
                      <td className="px-4 py-3 text-right font-mono">₹{fmt(p.current_price)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-500">₹{fmt(invested)}</td>
                      <td className="px-4 py-3 text-right font-mono">₹{fmt(current)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${isUp ? 'text-green-600' : 'text-red-600'}`}>
                        {isUp ? '+' : ''}₹{fmt(pnl)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${isUp ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {isUp ? '+' : ''}{fmt(pnlPct)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded">{p.product_type}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex gap-1.5">
                          <button disabled={orderBusy} onClick={() => handlePositionOrder(p, 'BUY')}
                            className="bg-green-50 hover:bg-green-100 disabled:opacity-50 text-green-700 border border-green-200 rounded px-2 py-1 text-xs font-semibold">BUY</button>
                          <button disabled={orderBusy} onClick={() => handlePositionOrder(p, 'SELL')}
                            className="bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-700 border border-red-200 rounded px-2 py-1 text-xs font-semibold">SELL</button>
                          <button disabled={orderBusy} onClick={() => handleExitPosition(p)}
                            className="bg-white hover:bg-red-50 disabled:opacity-50 text-red-700 border border-red-300 rounded px-2 py-1 text-xs font-semibold">EXIT</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {positions.length === 0 && (
                  <tr><td colSpan={10} className="text-center py-12 text-slate-400">No open positions. Place an order from the Dashboard.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'trades' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase">
                  <th className="px-4 py-2.5">Time</th>
                  <th className="px-4 py-2.5">Symbol</th>
                  <th className="px-4 py-2.5 text-center">Side</th>
                  <th className="px-4 py-2.5 text-right">Qty</th>
                  <th className="px-4 py-2.5 text-right">Price</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5 text-right">Brokerage</th>
                  <th className="px-4 py-2.5 text-right">STT</th>
                  <th className="px-4 py-2.5 text-right">Other fees</th>
                  <th className="px-4 py-2.5 text-right">Total charges</th>
                  <th className="px-4 py-2.5 text-right">Net realized P&amp;L</th>
                  <th className="px-4 py-2.5 text-center">Type</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                  <th className="px-4 py-2.5">Agent</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => {
                  let fee = {};
                  try { fee = JSON.parse(t.charge_breakdown || '{}'); } catch { fee = {}; }
                  const hasFeeData = Object.keys(fee).length > 0;
                  const otherFees = (fee.exchange_charges || 0) + (fee.sebi_charges || 0) + (fee.ipft_charges || 0) + (fee.gst || 0) + (fee.stamp_duty || 0);
                  return (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">{t.created_at?.replace('T', ' ').slice(0, 19)}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{t.symbol}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${t.side === 'BUY' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {t.side}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{t.quantity}</td>
                    <td className="px-4 py-2.5 text-right font-mono">₹{fmt(t.fill_price || t.price)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-500">₹{fmt((t.fill_price || t.price) * t.quantity)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{hasFeeData ? `₹${fmt(fee.brokerage)}` : '-'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{hasFeeData ? `₹${fmt(fee.stt)}` : '-'}</td>
                    <td className="px-4 py-2.5 text-right font-mono" title={hasFeeData ? `Exchange ₹${fmt(fee.exchange_charges)} · SEBI ₹${fmt(fee.sebi_charges)} · IPFT ₹${fmt(fee.ipft_charges)} · GST ₹${fmt(fee.gst)} · Stamp ₹${fmt(fee.stamp_duty)}` : 'Historical trade; charge breakdown not stored'}>{hasFeeData ? `₹${fmt(otherFees)}` : '-'}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-red-600">{hasFeeData ? `₹${fmt(t.charges)}` : '-'}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${(t.realized_pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {t.gross_realized_pnl == null ? '-' : !hasFeeData ? `₹${fmt(t.gross_realized_pnl)} gross` : `₹${fmt(t.realized_pnl)} net${t.gross_realized_pnl !== t.realized_pnl ? ` (gross ₹${fmt(t.gross_realized_pnl)})` : ''}`}
                    </td>
                    <td className="px-4 py-2.5 text-center"><span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded">{t.product_type}</span></td>
                    <td className="px-4 py-2.5 text-center"><span className="bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded font-medium">{t.status}</span></td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">{t.agent_verdict || '-'}</td>
                  </tr>
                );})}
                {trades.length === 0 && (
                  <tr><td colSpan={14} className="text-center py-12 text-slate-400">No trades yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, positive }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className="text-xs text-slate-500 font-medium">{label}</div>
      <div className={`text-xl font-bold mt-1 ${positive === true ? 'text-green-600' : positive === false ? 'text-red-600' : 'text-slate-800'}`}>
        {value}
      </div>
    </div>
  );
}
