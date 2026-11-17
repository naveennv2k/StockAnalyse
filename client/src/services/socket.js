import { io } from 'socket.io-client';

let socket;
const subscriptions = new Map();

function sendSubscriptions() {
  if (!socket?.connected) return;
  const symbols = [...new Set([...subscriptions.values()].flat())];
  socket.emit('subscribe:quotes', symbols);
}

// One shared connection; the Vite dev server proxies /socket.io to the backend.
export function getSocket() {
  if (!socket) {
    socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 15000 });
    socket.on('connect', sendSubscriptions);
  }
  return socket;
}

export function setQuoteSubscription(owner, symbols) {
  const normalized = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
  if (normalized.length) subscriptions.set(owner, normalized);
  else subscriptions.delete(owner);
  sendSubscriptions();
}
