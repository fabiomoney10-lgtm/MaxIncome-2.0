'use strict';

const express = require('express');
const path = require('path');
const { BybitClient } = require('./src/bybit');
const { TradingEngine } = require('./src/trading-engine');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const port = Number(process.env.PORT || 10000);
const assets = (process.env.ASSETS || 'XRPUSDT,BTCUSDT,ETHUSDT,SOLUSDT')
  .split(',').map(x => x.trim().toUpperCase()).filter(Boolean);

const client = new BybitClient({
  apiKey: process.env.BYBIT_API_KEY || '',
  apiSecret: process.env.BYBIT_SECRET_KEY || '',
  testnet: process.env.BYBIT_TESTNET !== 'false'
});
const engine = new TradingEngine({
  client,
  assets,
  legacyXrpReserved: Number(process.env.LEGACY_XRP_RESERVED || 6)
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'MaxIncome', mode: 'paper', timestamp: new Date().toISOString() });
});

app.get('/api/status', (_req, res) => {
  res.json(engine.getStatus());
});

app.get('/api/refresh', async (_req, res) => {
  try {
    await engine.runOnce();
    res.json(engine.getStatus());
  } catch (err) {
    res.status(502).json({ error: 'Falha ao atualizar dados', detail: err.message });
  }
});

app.get('/api/balance', async (_req, res) => {
  try {
    const balance = await client.getWalletBalance();
    res.json(balance);
  } catch (err) {
    res.status(502).json({ error: 'Não foi possível consultar a carteira', detail: err.message });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(port, '0.0.0.0', async () => {
  console.log(`MaxIncome disponível na porta ${port}. Modo PAPER.`);
  try { await engine.runOnce(); } catch (e) { console.error('[Inicialização]', e.message); }
  const interval = Math.max(15000, Number(process.env.ENGINE_INTERVAL_MS || 30000));
  setInterval(() => engine.runOnce().catch(e => console.error('[Motor]', e.message)), interval);
});