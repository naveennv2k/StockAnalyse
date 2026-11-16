import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter, { attachLiveFeed, flattradeCallback } from './routes/api.js';
import { LiveFeed } from './services/liveFeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8090;

// ── Express App ──
const app = express();
const httpServer = createServer(app);

// ── Socket.IO ──
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const io = new SocketIO(httpServer, {
  cors: { origin: [LOCAL_ORIGIN], methods: ['GET', 'POST'] },
});
const liveFeed = new LiveFeed(io);
attachLiveFeed(liveFeed);

// ── Middleware ──
app.use(cors({ origin: [LOCAL_ORIGIN] }));
app.use(express.json());

// ── API Routes ──
app.use('/api', apiRouter);

// Flattrade redirects to the app root with ?code=... when that is the registered redirect URL
app.get('/', (req, res, next) => (req.query.code ? flattradeCallback(req, res) : next()));

// ── Serve React Frontend (production build) ──
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

// ── Socket.IO Events ──
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Browser tells us which symbols it is watching; ticks arrive as 'tick' events, at most 1/sec per symbol.
  socket.on('subscribe:quotes', (symbols) => {
    if (!Array.isArray(symbols)) return;
    liveFeed.setWatching(socket, symbols).catch((e) => console.error('Live feed error:', e.message));
  });

  socket.on('disconnect', () => {
    liveFeed.releaseSocket(socket);
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Make io accessible to routes
app.set('io', io);
app.set('liveFeed', liveFeed);

// ── Start Server ──
httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║  🚀 Trading Agent Platform                      ║
║  🌐 http://127.0.0.1:${PORT}                       ║
║  📡 WebSocket ready                              ║
║  💾 SQLite database initialized                  ║
╚══════════════════════════════════════════════════╝
  `);
});

export { app, io };
