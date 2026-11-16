import { useState, useEffect, useCallback } from 'react';
import { getPositions, getTrades, getWallet } from '../services/api';
import { RefreshCw, TrendingUp, TrendingDown, ArrowUpDown } from 'lucide-react';

const fmt = (v) => v != null ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

export default function Positions() {
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState({});
  const [wallet, setWallet] = useState({});
  const [tab, setTab] = useState('positions');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [posRes, tradeRes, walletRes] = await Promise.all([getPositions(), getTrades(100), getWallet()]);
      setPositions(posRes.positions || []);
      setTrades(tradeRes.trades || []);
      setStats(tradeRes.stats || {});
      setWallet(walletRes);
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

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-blue-500" size={32} /></div>;

  const totalInvested = positions.reduce((s, p) => s + p.avg_price * p.quantity, 0);
  const totalCurrent = positions.reduce((s, p) => s + p.current_price * p.quantity, 0);
  const totalPnl = wallet.unrealized_pnl ?? (totalCurrent - totalInvested);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
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

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="border-b border-slate-100 px-4 flex gap-0">
          {[
            { id: 'positions', label: `📊 Open Positions (${positions.length})` },
            { id: 'trades', label: `📑 Trade History (${trades.length})` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition ${tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center">
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
                    </tr>
                  );
                })}
                {positions.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-12 text-slate-400">No open positions. Place an order from the Dashboard.</td></tr>
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
