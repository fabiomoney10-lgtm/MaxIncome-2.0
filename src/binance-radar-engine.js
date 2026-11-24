'use strict';

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await worker(items[index], index); }
      catch (error) { results[index] = { error: error.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

class BinanceRadarEngine {
  constructor({ scanner, client, analyzeLongSetup, candidateLimit = 10, minScore = 85 }) {
    if (!scanner || !client || typeof analyzeLongSetup !== 'function') throw new Error('Dependências do Radar Binance obrigatórias.');
    this.scanner = scanner;
    this.client = client;
    this.analyzeLongSetup = analyzeLongSetup;
    this.candidateLimit = candidateLimit;
    this.minScore = minScore;
    this.lastRun = null;
  }

  async runOnce() {
    const universe = await this.scanner.scan();
    const candidates = universe.candidates.slice(0, this.candidateLimit);
    const btcFrames = {};
    for (const timeframe of ['1h', '4h']) {
      btcFrames[timeframe] = await this.client.getKlines('BTCUSDT', timeframe, 100);
    }
    const analyses = await mapLimit(candidates, 2, async candidate => {
      const frames = {};
      const responses = await Promise.all(TIMEFRAMES.map(tf => this.client.getKlines(candidate.symbol, tf, 100)));
      TIMEFRAMES.forEach((tf, index) => { frames[tf] = responses[index]; });
      return this.analyzeLongSetup({ symbol: candidate.symbol, frames, btcFrames, scannerScore: candidate.scannerScore, currentPrice: candidate.lastPrice, minScore: this.minScore });
    });
    const signals = analyses.filter(item => item && item.status === 'SIGNAL');
    this.lastRun = {
      scannedAt: new Date().toISOString(), source: 'BINANCE SPOT PUBLIC API',
      universeCount: universe.eligibleCount, candidatesAnalyzed: candidates.length,
      rejectedCount: analyses.length - signals.length, signals,
      ordersEnabled: false, executionMode: 'SIGNALS_ONLY'
    };
    return this.lastRun;
  }
}

module.exports = { BinanceRadarEngine, TIMEFRAMES, mapLimit };
