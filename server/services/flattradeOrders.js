import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '..', 'pythonAPI', '.env');
const API_URL = 'https://piconnect.flattrade.in/PiConnectAPI';
const SYMBOL_RE = /^[A-Z0-9&_-]{1,30}$/;
const USER_RE = /^[A-Za-z0-9]{3,20}$/;
const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const MUTATING_ENDPOINTS = new Set(['PlaceOrder', 'ModifyOrder', 'CancelOrder']);
let cachedEgressIp = null;

function readCredentials() {
  const contents = fs.readFileSync(ENV_PATH, 'utf8');
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(FLATTRADE_USER_ID|FLATTRADE_USER_TOKEN|FLATTRADE_STATIC_IP)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  const userId = values.FLATTRADE_USER_ID;
  const token = values.FLATTRADE_USER_TOKEN;
  if (!USER_RE.test(userId || '') || !/^[A-Za-z0-9._-]{10,300}$/.test(token || '')) {
    throw new Error('Flattrade session is missing or invalid. Reconnect on the Integrations page.');
  }
  return { userId, token, staticIp: values.FLATTRADE_STATIC_IP };
}

async function assertWhitelistedStaticIp(expectedIp) {
  if (!IPV4_RE.test(expectedIp || '')) {
    throw new Error('Set FLATTRADE_STATIC_IP in pythonAPI/.env to the public IPv4 whitelisted by Flattrade before placing live orders.');
  }
  if (!cachedEgressIp || Date.now() - cachedEgressIp.checkedAt > 60000) {
    const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Could not verify the server public IP; live order request blocked.');
    const body = await response.json().catch(() => ({}));
    if (!IPV4_RE.test(body.ip || '')) throw new Error('Public IP lookup returned an invalid IPv4; live order request blocked.');
    cachedEgressIp = { ip: body.ip, checkedAt: Date.now() };
  }
  if (cachedEgressIp.ip !== expectedIp) {
    throw new Error('Server public IP does not match FLATTRADE_STATIC_IP; live order request blocked.');
  }
}

async function post(credentials, endpoint, data) {
  if (MUTATING_ENDPOINTS.has(endpoint)) await assertWhitelistedStaticIp(credentials.staticIp);
  const response = await fetch(`${API_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: `jData=${JSON.stringify(data)}`,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Flattrade request failed (HTTP ${response.status})`);
  if (!result || result.stat === 'Not_Ok') {
    throw new Error(result?.emsg || `Flattrade ${endpoint} request failed`);
  }
  return result;
}

function resolveContract(values, symbol, exchange) {
  const requested = symbol.endsWith('-EQ') || symbol.endsWith('-BE') || symbol.endsWith('-BZ')
    ? symbol
    : `${symbol}-EQ`;
  return values.find((item) => item.exch === exchange && item.tsym === requested);
}

export class FlattradeOrders {
  async verifyStaticIp() {
    const credentials = readCredentials();
    await assertWhitelistedStaticIp(credentials.staticIp);
    return { verified: true };
  }

  async getAccount() {
    const credentials = readCredentials();
    const account = { uid: credentials.userId, actid: credentials.userId };
    const limits = await post(credentials, 'Limits', account);
    const rawPositions = await post(credentials, 'PositionBook', account);
    const rawHoldings = await post(credentials, 'Holdings', { ...account, prd: 'C' }).catch(() => []);
    const positions = (Array.isArray(rawPositions) ? rawPositions : [])
      .filter((position) => Number(position.netqty) !== 0)
      .map((position) => ({
        symbol: String(position.tsym || '').replace(/-(EQ|BE|BZ)$/, ''),
        contract: String(position.tsym || ''),
        exchange: position.exch || 'NSE',
        quantity: Number(position.netqty),
        avg_price: Number(position.netavgprc) || 0,
        current_price: Number(position.lp) || 0,
        unrealized_pnl: Number(position.urmtom) || 0,
        product_type: position.prd || '',
      }));
    const holdings = (Array.isArray(rawHoldings) ? rawHoldings : [])
      .filter((holding) => Number(holding.holdqty || 0) + Number(holding.btstqty || 0) > 0)
      .map((holding) => {
        const contract = (holding.exch_tsym || [])[0] || {};
        const name = String(contract.tsym || '');
        return { symbol: name.replace(/-(EQ|BE|BZ)$/, ''), exchange: contract.exch || 'NSE' };
      });
    return {
      connected: true,
      cash: Number(limits.cash) || 0,
      payin: Number(limits.payin) || 0,
      margin_used: Number(limits.marginused) || 0,
      positions,
      holdings,
    };
  }

  async getOrder(orderNumber) {
    const credentials = readCredentials();
    const orders = await post(credentials, 'OrderBook', { uid: credentials.userId, ordersource: 'API' });
    return (Array.isArray(orders) ? orders : []).find((order) => String(order.norenordno) === String(orderNumber)) || null;
  }

  async getOrderBook() {
    const credentials = readCredentials();
    const result = await post(credentials, 'OrderBook', { uid: credentials.userId, ordersource: 'API' });
    return (Array.isArray(result) ? result : []).map((order) => ({
      order_number: String(order.norenordno || ''),
      created_at: order.norentm || order.ordenttm || order.exch_tm || '',
      symbol: String(order.tsym || '').replace(/-(EQ|BE|BZ)$/, ''),
      exchange: order.exch || 'NSE',
      side: order.trantype === 'B' ? 'BUY' : order.trantype === 'S' ? 'SELL' : order.trantype || '',
      quantity: Number(order.qty) || 0,
      filled_quantity: Number(order.fillshares) || 0,
      fill_price: Number(order.avgprc) || 0,
      price: Number(order.prc) || 0,
      order_type: order.prctyp || '',
      product_type: order.prd || '',
      status: order.status || '',
      rejection_reason: order.rejreason || '',
      remarks: order.remarks || '',
    }));
  }

  async findOrderByRemarks(remarks) {
    const credentials = readCredentials();
    const orders = await post(credentials, 'OrderBook', { uid: credentials.userId, ordersource: 'API' });
    return (Array.isArray(orders) ? orders : []).find((order) => order.remarks === remarks) || null;
  }

  async cancelOrder(orderNumber) {
    const credentials = readCredentials();
    return post(credentials, 'CancelOrder', {
      uid: credentials.userId,
      norenordno: String(orderNumber),
      ordersource: 'API',
    });
  }

  async placeStopMarketOrder({ symbol, exchange = 'NSE', side, quantity, triggerPrice, remarks }) {
    const cleanSymbol = String(symbol || '').trim().toUpperCase();
    const cleanExchange = String(exchange || '').trim().toUpperCase();
    const cleanSide = String(side || '').trim().toUpperCase();
    const qty = Number(quantity);
    const trigger = Number(triggerPrice);
    if (!SYMBOL_RE.test(cleanSymbol) || !['NSE', 'BSE'].includes(cleanExchange)) throw new Error('Invalid Flattrade stop contract');
    if (!['BUY', 'SELL'].includes(cleanSide) || !Number.isSafeInteger(qty) || qty < 1 || !Number.isFinite(trigger) || trigger <= 0) {
      throw new Error('Invalid Flattrade stop order parameters');
    }
    const credentials = readCredentials();
    const account = { uid: credentials.userId, actid: credentials.userId };
    await post(credentials, 'Limits', account);
    const search = await post(credentials, 'SearchScrip', {
      uid: credentials.userId,
      exch: cleanExchange,
      stext: encodeURIComponent(cleanSymbol.replace(/-(EQ|BE|BZ)$/, '')),
    });
    const contract = resolveContract(search.values || [], cleanSymbol, cleanExchange);
    if (!contract?.tsym) throw new Error(`Could not resolve ${cleanSymbol} to an exact ${cleanExchange} equity contract`);
    const result = await post(credentials, 'PlaceOrder', {
      ...account,
      exch: cleanExchange,
      tsym: contract.tsym,
      qty: String(qty),
      prc: '0',
      trgprc: String(Math.round(trigger * 100) / 100),
      dscqty: '0',
      prd: 'M',
      trantype: cleanSide === 'BUY' ? 'B' : 'S',
      prctyp: 'SL-MKT',
      ret: 'DAY',
      remarks: String(remarks || 'AI_STOP').replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 30),
      ordersource: 'WEB',
    });
    if (!result.norenordno) throw new Error('Flattrade did not return a stop order number');
    return { order_number: result.norenordno, symbol: contract.tsym, exchange: cleanExchange, quantity: qty, side: cleanSide, trigger_price: trigger };
  }

  async modifyStopMarketOrder({ orderNumber, symbol, exchange = 'NSE', quantity, triggerPrice }) {
    const cleanSymbol = String(symbol || '').trim().toUpperCase();
    const cleanExchange = String(exchange || '').trim().toUpperCase();
    const qty = Number(quantity);
    const trigger = Number(triggerPrice);
    if (!SYMBOL_RE.test(cleanSymbol) || !['NSE', 'BSE'].includes(cleanExchange)) throw new Error('Invalid Flattrade stop contract');
    if (!Number.isSafeInteger(qty) || qty < 1 || !Number.isFinite(trigger) || trigger <= 0) throw new Error('Invalid Flattrade stop modification');
    const credentials = readCredentials();
    const orders = await post(credentials, 'OrderBook', { uid: credentials.userId, ordersource: 'API' });
    const existing = (Array.isArray(orders) ? orders : []).find((order) => String(order.norenordno) === String(orderNumber));
    if (!existing) throw new Error('Flattrade stop order was not found in the order book');
    const result = await post(credentials, 'ModifyOrder', {
      uid: credentials.userId,
      actid: credentials.userId,
      norenordno: String(orderNumber),
      exch: cleanExchange,
      tsym: encodeURIComponent(existing.tsym || cleanSymbol),
      qty: String(qty),
      prctyp: 'SL-MKT',
      prc: '0',
      trgprc: String(Math.round(trigger * 100) / 100),
      ordersource: 'API',
    });
    return result;
  }

  async getQuote(symbol, exchange = 'NSE') {
    const cleanSymbol = String(symbol || '').trim().toUpperCase();
    const cleanExchange = String(exchange || '').trim().toUpperCase();
    if (!SYMBOL_RE.test(cleanSymbol) || !['NSE', 'BSE'].includes(cleanExchange)) throw new Error('Invalid Flattrade quote request');
    const credentials = readCredentials();
    const search = await post(credentials, 'SearchScrip', {
      uid: credentials.userId,
      exch: cleanExchange,
      stext: encodeURIComponent(cleanSymbol.replace(/-(EQ|BE|BZ)$/, '')),
    });
    const contract = resolveContract(search.values || [], cleanSymbol, cleanExchange);
    if (!contract?.token) throw new Error(`Could not resolve ${cleanSymbol} to an exact ${cleanExchange} equity contract`);
    const quote = await post(credentials, 'GetQuotes', { uid: credentials.userId, exch: cleanExchange, token: contract.token });
    const ltp = Number(quote.lp);
    if (!Number.isFinite(ltp) || ltp <= 0) throw new Error(`Flattrade returned no valid price for ${contract.tsym}`);
    return {
      symbol: cleanSymbol.replace(/-(EQ|BE|BZ)$/, ''),
      contract: contract.tsym,
      exchange: cleanExchange,
      ltp,
      tick_size: Number(quote.ti) > 0 ? Number(quote.ti) : 0.05,
    };
  }

  async placeMarketOrder({ symbol, exchange = 'NSE', side, quantity, remarks = 'dashboard_order' }) {
    const cleanSymbol = String(symbol || '').trim().toUpperCase();
    const cleanExchange = String(exchange || '').trim().toUpperCase();
    const cleanSide = String(side || '').trim().toUpperCase();
    const qty = Number(quantity);
    if (!SYMBOL_RE.test(cleanSymbol)) throw new Error('Enter a valid Flattrade symbol');
    if (!['NSE', 'BSE'].includes(cleanExchange)) throw new Error('Only NSE and BSE cash orders are supported');
    if (!['BUY', 'SELL'].includes(cleanSide)) throw new Error('Order side must be BUY or SELL');
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 100000) throw new Error('Quantity must be a whole number between 1 and 100000');

    const credentials = readCredentials();
    const account = { uid: credentials.userId, actid: credentials.userId };
    await post(credentials, 'Limits', account);
    const search = await post(credentials, 'SearchScrip', {
      uid: credentials.userId,
      exch: cleanExchange,
      stext: encodeURIComponent(cleanSymbol.replace(/-(EQ|BE|BZ)$/, '')),
    });
    const contract = resolveContract(search.values || [], cleanSymbol, cleanExchange);
    if (!contract?.tsym) throw new Error(`Could not resolve ${cleanSymbol} to an exact ${cleanExchange} equity contract`);

    let result;
    try {
      result = await post(credentials, 'PlaceOrder', {
        ...account,
        exch: cleanExchange,
        tsym: contract.tsym,
        qty: String(qty),
        prc: '0',
        dscqty: '0',
        prd: 'M',
        trantype: cleanSide === 'BUY' ? 'B' : 'S',
        prctyp: 'MKT',
        ret: 'DAY',
        remarks: String(remarks).replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 30) || 'dashboard_order',
        ordersource: 'WEB',
      });
    } catch (error) {
      throw new Error(`Could not confirm Flattrade order status: ${error.message}. Check the broker order book before retrying.`);
    }
    if (!result.norenordno) throw new Error('Flattrade did not return an order number; check the broker order book before retrying');

    return {
      success: true,
      broker: 'flattrade',
      order_number: result.norenordno,
      status: result.stat,
      symbol: contract.tsym,
      exchange: cleanExchange,
      side: cleanSide,
      quantity: qty,
      order_type: 'MARKET',
      product_type: 'MIS',
    };
  }
}