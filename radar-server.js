'use strict';

const express = require('express');
const path = require('node:path');
const { BinanceSpotClient } = require('./src/binance-spot-client');
const { BinanceUniverseScanner } = require('./src/binance-universe-scanner');
const { BinanceRadarEngine } = require('./src/binance-radar-engine');
const { analyzeLongSetup } = require('./src/binance-radar-analysis');
const { createReadTokenMiddleware } = require('./src/read-token');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

const client = new BinanceSpotClient({ timeoutMs: Number(process.env.BINANCE_HTTP_TIMEOUT_MS || 10000) });
const scanner = new BinanceUniverseScanner({
  client,
  minQuoteVolume: Number(process.env.RADAR_MIN_QUOTE_VOLUME_USDT || 1000000),
  maxSpreadPct: Number(process.env.RADAR_MAX_SPREAD_PCT || 0.15),
  candidateLimit: Number(process.env.RADAR_UNIVERSE_LIMIT || 50)
});
const engine = new BinanceRadarEngine({
  scanner, client, analyzeLongSetup,
  candidateLimit: Number(process.env.RADAR_ANALYSIS_LIMIT || 10),
  minScore: Number(process.env.RADAR_MIN_SIGNAL_SCORE || 85)
});
const requireReadToken = createReadTokenMiddleware();

app.get('/api/health', (_req, res) => res.json({
  ok: true, service: 'MaxIncome Radar', market: 'BINANCE SPOT',
  mode: 'SIGNALS_ONLY', ordersEnabled: false, timestamp: new Date().toISOString()
}));
app.get('/api/radar/universe', requireReadToken, async (_req, res) => {
  try {
    const result = await scanner.scan();
    res.json({ ...result, source: 'BINANCE SPOT PUBLIC API', ordersEnabled: false });
  } catch (error) {
    res.status(503).json({ error: 'Scanner Binance indisponível.', detail: error.message, ordersEnabled: false });
  }
});
app.get('/api/radar/signals', requireReadToken, async (_req, res) => {
  try {
    res.json(await engine.runOnce());
  } catch (error) {
    res.status(503).json({
      error: 'Análise de sinais indisponível.', detail: error.message,
      ordersEnabled: false, timestamp: new Date().toISOString()
    });
  }
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'radar.html')));

const port = Number(process.env.PORT || 10000);
app.listen(port, '0.0.0.0', () => {
  console.log('MaxIncome Radar iniciado: Binance Spot, somente sinais; ordens desabilitadas.');
});
