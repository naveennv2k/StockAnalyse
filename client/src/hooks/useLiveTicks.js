import { useEffect, useRef, useState } from 'react';
import { getSocket, setQuoteSubscription } from '../services/socket';

/** Subscribes to server-pushed ticks (max 1/sec per symbol) for the given symbols. */
export function useLiveTicks(symbols) {
  const [ticks, setTicks] = useState({});
  const [status, setStatus] = useState({ connected: false, error: null });
  const key = [...new Set(symbols)].sort().join(',');
  const owner = useRef(Symbol('live-tick-subscriber'));

  useEffect(() => {
    const socket = getSocket();
    const list = key ? key.split(',') : [];
    const onTick = (t) => setTicks((prev) => ({ ...prev, [t.symbol]: t }));

    socket.on('tick', onTick);
    socket.on('feed:status', setStatus);
    setQuoteSubscription(owner.current, list);

    return () => {
      socket.off('tick', onTick);
      socket.off('feed:status', setStatus);
      setQuoteSubscription(owner.current, []);
    };
  }, [key]);

  return { ticks, status };
}
