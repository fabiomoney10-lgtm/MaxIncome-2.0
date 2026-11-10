'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { BybitClient, candleEndTime } = require('../src/bybit');
const { runSmaBacktest } = require('../src/backtest');
const { runStrategyComparisonBacktest } = require('../src/strategy-backtest');
const { calculateMinimumTargetPct, DEFAULT_STOP_SLIPPAGE_BUFFER_PCT } = require('../src/risk-guards');

const SYMBOLS = ['XRPUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const INTERVALS = ['15', '60', '240', 'D'];
const TARGET_CANDLES = 3000;
const PAGE_SIZE = 1000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchHistory(client, symbol, interval) {
  const byStart = new Map();
  let end = Date.now();
  for (let page = 0; page < Math.ceil(TARGET_CANDLES / PAGE_SIZE); page++) {
    const result = await client.request('GET', '/v5/market/kline', {
      category: 'spot', symbol, interval, limit: String(PAGE_SIZE), end: String(end)
    });
    const rows = result.list || [];
    if (!rows.length) break;
    let oldest = Infinity;
    for (const row of rows) {
      const start = Number(row[0]);
      const candle = {
        start,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5])
      };
      const candleEnd = candleEndTime(start, interval);
      if (!Number.isFinite(start) || !Number.isFinite(candleEnd) || candleEnd > Date.now() ||
          ![candle.open,candle.high,candle.low,candle.close].every(Number.isFinite) ||
          candle.open <= 0 || candle.high < Math.max(candle.open,candle.close,candle.low) ||
          candle.low > Math.min(candle.open,candle.close,candle.high) ||
          !Number.isFinite(candle.volume) || candle.volume < 0) continue;
      byStart.set(start, candle);
      oldest = Math.min(oldest, start);
    }
    if (!Number.isFinite(oldest) || rows.length < PAGE_SIZE) break;
    end = oldest - 1;
    await sleep(150);
  }
  return Array.from(byStart.values()).sort((a,b)=>a.start-b.start).slice(-TARGET_CANDLES);
}

function metricsForSma(candles, splitIndex) {
  const train = runSmaBacktest(candles.slice(0, splitIndex), {
    initialCapital: 5000, riskPerTrade: 50, stopLossPct: 1,
    feeRatePerSide: 0.001, slippagePct: DEFAULT_STOP_SLIPPAGE_BUFFER_PCT
  });
  // Include 21 prior candles for indicator warm-up; no test-period candle is used for a signal.
  const test = runSmaBacktest(candles.slice(Math.max(0, splitIndex - 21)), {
    initialCapital: 5000, riskPerTrade: 50, stopLossPct: 1,
    feeRatePerSide: 0.001, slippagePct: DEFAULT_STOP_SLIPPAGE_BUFFER_PCT
  });
  return { inSample: train.metrics, outOfSample: test.metrics };
}

async function main() {
  const client = new BybitClient({ testnet: true });
  const report = {
    generatedAt: new Date().toISOString(),
    source: 'Bybit public spot OHLCV candles',
    assumptions: {
      symbols: SYMBOLS, intervals: INTERVALS, targetCandlesPerSeries: TARGET_CANDLES,
      initialCapitalQuote: 5000, riskPerTradeQuote: 50, stopLossPct: 1,
      feeRatePerSide: 0.001, slippagePctPerSide: DEFAULT_STOP_SLIPPAGE_BUFFER_PCT,
      trainRatio: 0.7, signalOnClosedCandle: true, entryAtNextCandleOpen: true,
      stopFirstWhenBothTouched: true, quoteCurrency: 'USDT',
      limitations: ['independent symbol/timeframe runs; no portfolio/shared daily risk simulation',
        'drawdown measured after closed trades; intratrade drawdown excluded',
        'no spread, order-book depth, market impact, latency or funding costs',
        'historical results do not predict future performance']
    },
    series: []
  };

  for (const symbol of SYMBOLS) {
    for (const interval of INTERVALS) {
      const candles = await fetchHistory(client, symbol, interval);
      const entry = { symbol, interval, candleCount: candles.length };
      if (candles.length < 110) {
        entry.status = 'INSUFFICIENT_HISTORY';
        report.series.push(entry);
        continue;
      }
      const splitIndex = Math.floor(candles.length * 0.7);
      entry.status = 'OK';
      entry.start = new Date(candles[0].start).toISOString();
      entry.end = new Date(candles[candles.length - 1].start).toISOString();
      entry.split = {
        trainEnd: new Date(candles[splitIndex - 1].start).toISOString(),
        outOfSampleStart: new Date(candles[splitIndex].start).toISOString()
      };
      entry.baselineSma9x21 = metricsForSma(candles, splitIndex);
      const suite = runStrategyComparisonBacktest(candles, {
        initialCapital: 5000, riskPerTrade: 50, stopLossPct: 1,
        feeRatePerSide: 0.001, slippagePct: DEFAULT_STOP_SLIPPAGE_BUFFER_PCT,
        trainRatio: 0.7
      });
      entry.strategySuite = Object.fromEntries(Object.entries(suite.results).map(([name, value]) => [name, {
        inSample: value.inSample.metrics,
        outOfSample: value.outOfSample.metrics
      }]));
      report.series.push(entry);
      console.log('Completed', symbol, interval, candles.length);
    }
  }

  const outputDir = path.join(process.cwd(), 'reports');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'historical-backtest.json'), JSON.stringify(report, null, 2));
  const lines = [
    '# MaxIncome 2.0 — histórico PAPER',
    '',
    'Fonte: candles públicos OHLCV da Bybit Spot. Valores de P&L em USDT, não em BRL.',
    '',
    'Custos simulados: taxa 0,1% por lado e slippage adverso 0,25% por lado. Entrada no candle seguinte; stop-first quando stop e alvo aparecem no mesmo candle.',
    '',
    '| Ativo | Período | Candles | SMA 9/21 OOS trades | SMA 9/21 OOS líquido | SMA PF | Trend OOS líquido | Momentum OOS líquido | Mean reversion OOS líquido |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|'
  ];
  for (const item of report.series) {
    if (item.status !== 'OK') {
      lines.push(`| ${item.symbol} / ${item.interval} | — | ${item.candleCount} | — | — | — | — | — | — |`);
      continue;
    }
    const sma = item.baselineSma9x21.outOfSample;
    const suite = item.strategySuite;
    lines.push(`| ${item.symbol} / ${item.interval} | ${item.start.slice(0,10)}–${item.end.slice(0,10)} | ${item.candleCount} | ${sma.trades} | ${sma.netPnl.toFixed(2)} | ${sma.profitFactor === null ? 'n/a' : sma.profitFactor.toFixed(2)} | ${suite.TREND_FOLLOWING.outOfSample.netPnl.toFixed(2)} | ${suite.MOMENTUM.outOfSample.netPnl.toFixed(2)} | ${suite.MEAN_REVERSION.outOfSample.netPnl.toFixed(2)} |`);
  }
  lines.push('', '## Limitações', '', ...report.assumptions.limitations.map(value => '- ' + value),
    '', 'Este relatório é pesquisa histórica, não recomendação de investimento nem prova de vantagem futura.');
  await fs.writeFile(path.join(outputDir, 'historical-backtest.md'), lines.join('\n') + '\n');
  console.log('Historical backtest report written to reports/.');
}

main().catch(error => {
  console.error('Historical backtest failed:', error && error.message ? error.message : error);
  process.exitCode = 1;
});
