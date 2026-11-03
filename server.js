'use strict';

const crypto = require('crypto');
const express = require('express');
const path = require('path');
const { BybitClient } = require('./src/bybit');
const { TradingEngine } = require('./src/trading-engine');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

const port = Number(process.env.PORT || 10000);
const assets = (process.env.ASSETS || 'XRPUSDT,BTCUSDT,ETHUSDT,SOLUSDT')
  .split(',').map(x => x.trim().toUpperCase()).filter(Boolean);

const client = new BybitClient({
  apiKey: process.env.BYBIT_API_KEY || '',
  apiSecret: process.env.BYBIT_SECRET_KEY || ''
});
const engine = new TradingEngine({
  client,
  assets,
  legacyXrpReserved: Number(process.env.LEGACY_XRP_RESERVED || 6)
});

// Headers defensivos aplicados tanto ao painel quanto à API.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (_req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// Endpoint mínimo para health checks do provedor de hospedagem.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'MaxIncome', mode: 'paper', timestamp: new Date().toISOString() });
});

const dashboardUser = process.env.DASHBOARD_USER || '';
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
const failedAttempts = new Map();
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireDashboardAuth(req, res, next) {
  // Falha fechada: não expõe painel nem dados quando a autenticação não foi configurada.
  if (!dashboardUser || !dashboardPassword) {
    return res.status(503).json({ error: 'Acesso indisponível: configure DASHBOARD_USER e DASHBOARD_PASSWORD.' });
  }

  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempt = failedAttempts.get(ip);
  if (attempt && attempt.lockedUntil > now) {
    return res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' });
  }
  if (attempt && attempt.windowStartedAt + LOCKOUT_MS <= now) failedAttempts.delete(ip);

  const header = req.headers.authorization || '';
  const match = header.match(/^Basic ([A-Za-z0-9+/]+=*)$/);
  let username = '';
  let password = '';
  if (match) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator >= 0) {
        username = decoded.slice(0, separator);
        password = decoded.slice(separator + 1);
      }
    } catch (_) {
      // Credenciais malformadas são tratadas como falha de autenticação.
    }
  }

  if (safeEqual(username, dashboardUser) && safeEqual(password, dashboardPassword)) {
    failedAttempts.delete(ip);
    return next();
  }

  const current = failedAttempts.get(ip);
  const windowStartedAt = current ? current.windowStartedAt : now;
  const count = current && current.windowStartedAt + LOCKOUT_MS > now ? current.count + 1 : 1;
  failedAttempts.set(ip, {
    count,
    windowStartedAt,
    lockedUntil: count >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_MS : 0
  });
  res.setHeader('WWW-Authenticate', 'Basic realm="MaxIncome 2.0", charset="UTF-8"');
  return res.status(count >= MAX_FAILED_ATTEMPTS ? 429 : 401)
    .json({ error: 'Autenticação necessária.' });
}

// Toda a aplicação, inclusive arquivos do painel e endpoints privados, exige login.
app.use(requireDashboardAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (_req, res) => {
  res.json(engine.getStatus());
});

app.get('/api/refresh', async (_req, res) => {
  try {
    await engine.runOnce();
    res.json(engine.getStatus());
  } catch (_err) {
    console.error('[API refresh] Falha ao atualizar dados.');
    res.status(502).json({ error: 'Falha ao atualizar dados. Consulte os logs do servidor.' });
  }
});

app.get('/api/balance', async (_req, res) => {
  try {
    const balance = await client.getWalletBalance();
    res.json(balance);
  } catch (_err) {
    console.error('[API balance] Falha ao consultar carteira.');
    res.status(502).json({ error: 'Não foi possível consultar a carteira. Consulte os logs do servidor.' });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(port, '0.0.0.0', async () => {
  console.log(`MaxIncome disponível na porta ${port}. Modo PAPER.`);
  try { await engine.runOnce(); } catch (_) { console.error('[Inicialização] Falha na primeira sincronização.'); }
  const interval = Math.max(15000, Number(process.env.ENGINE_INTERVAL_MS || 30000));
  setInterval(() => engine.runOnce().catch(() => console.error('[Motor] Falha na sincronização.')), interval);
});
