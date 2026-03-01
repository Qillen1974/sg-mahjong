/**
 * SG Mahjong Game Server
 *
 * Express + WebSocket server for multiplayer mahjong.
 * Runs on PORT (default 3001).
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { PORT } from './config.js';
import { router as apiRouter } from './api.js';
import { setupWebSocket } from './ws-handler.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// REST API
app.use('/api', apiRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Create HTTP server and attach WebSocket
const server = createServer(app);
setupWebSocket(server);

server.listen(PORT, () => {
  console.log(`SG Mahjong server running on port ${PORT}`);
  console.log(`  REST API: http://localhost:${PORT}/api`);
  console.log(`  WebSocket: ws://localhost:${PORT}/ws`);
});

export { app, server };
