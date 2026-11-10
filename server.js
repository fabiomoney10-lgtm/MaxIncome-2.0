'use strict';
const express=require('express');
const path=require('path');
const {BybitClient}=require('./src/bybit');
const {TradingEngine}=require('./src/trading-engine');
const {SwingEngine}=require('./src/swing-engine');
const {SwingPaperTrader}=require('./src/swing-paper-trader');
const {createReadTokenMiddleware}=require('./src/read-token');
const {createPool,PaperTrader}=require('./src/paper-trader');
const {runStrategyComparisonBacktest}=require('./src/strategy-backtest');

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'20kb'}));
app.use(express.static(path.join(__dirname,'public')));
const port=Number(process.env.PORT||10000);
const assets=(process.env.ASSETS||'XRPUSDT,BTCUSDT,ETHUSDT,SOLUSDT').split(',').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9]{3,20}USDT$/.test(x));
const bybitEnvironment=(process.env.BYBIT_ENV||(process.env.BYBIT_TESTNET==='false'?'mainnet':'testnet')).toLowerCase();
if(!['testnet','mainnet'].includes(bybitEnvironment))throw new Error('BYBIT_ENV deve ser testnet ou mainnet.');
const client=new BybitClient({apiKey:'',apiSecret:'',testnet:bybitEnvironment==='testnet'});
const engine=new TradingEngine({
 client,assets,legacyXrpReserved:Number(process.env.LEGACY_XRP_RESERVED||6),
 maxRiskBRL:process.env.MAX_RISK_BRL||50,maxDailyLossBRL:process.env.MAX_DAILY_LOSS_BRL||100,
 maxTradesPerDay:process.env.MAX_TRADES_PER_DAY||5,maxExposureBRL:process.env.MAX_EXPOSURE_BRL||5000,
 stopLossPct:process.env.PAPER_STOP_LOSS_PCT||1,takeProfitPct:process.env.PAPER_TAKE_PROFIT_PCT||2
});
const swingIntervalMs=Math.max(60000,Number(process.env.SWING_INTERVAL_MS||300000));
const swingEngine=new SwingEngine({client,assets,intervalMs:swingIntervalMs});
let pool=null,paperTrader=null,swingPaperTrader=null,databaseError=null;
const engineLoop={running:false,lastStartedAt:null,lastSuccessAt:null,lastError:null};
const swingLoop={running:false,lastStartedAt:null,lastSuccessAt:null,lastError:null};
try{
 pool=createPool(process.env.DATABASE_URL||'');
 paperTrader=new PaperTrader({pool,assets,stopLossPct:process.env.PAPER_STOP_LOSS_PCT||1,feeRatePerSide:process.env.PAPER_FEE_RATE_PER_SIDE||0.001});
 swingPaperTrader=new SwingPaperTrader({pool,fxProvider:()=>paperTrader.getFxRate()});
}catch(e){databaseError=e.message;}
async function runCycle(){
 if(engineLoop.running)return;
 engineLoop.running=true;
 engineLoop.lastStartedAt=new Date().toISOString();
 try{
  await engine.runOnce();
  if(!paperTrader)throw new Error(databaseError||'DATABASE_URL não configurada.');
  await paperTrader.runOnce(engine.getStatus().assets||{});
  engineLoop.lastSuccessAt=new Date().toISOString();
  engineLoop.lastError=null;
 }catch(e){
  engineLoop.lastError=e.message;
  throw e;
 }finally{engineLoop.running=false;}
}
async function runSwingCycle(){
 if(swingLoop.running)return;
 swingLoop.running=true;
 swingLoop.lastStartedAt=new Date().toISOString();
 try{
  await swingEngine.runOnce();
  if(!swingPaperTrader)throw new Error(databaseError||'Banco PAPER não configurado.');
  await swingPaperTrader.runOnce(swingEngine.getStatus().assets||{});
  swingLoop.lastSuccessAt=new Date().toISOString();
  swingLoop.lastError=null;
 }catch(e){
  swingLoop.lastError=e.message;
  throw e;
 }finally{swingLoop.running=false;}
}
function publicStatus(){
 const s=engine.getStatus();
 const {balance,botXrpAvailable,...safe}=s;
 return {...safe,balanceAvailable:false};
}
const requireReadToken=createReadTokenMiddleware();

app.get('/api/health',async(_req,res)=>{
 let db=false;
 try{if(pool){await pool.query('SELECT 1');db=true;}}catch(e){databaseError=e.message;}
 const marketConnected=engine.getStatus().connected;
 const cycleFresh=!!engineLoop.lastSuccessAt&&(Date.now()-Date.parse(engineLoop.lastSuccessAt)<120000);
 const swingFresh=!!swingLoop.lastSuccessAt&&(Date.now()-Date.parse(swingLoop.lastSuccessAt)<swingIntervalMs*3);
 const ok=db&&marketConnected&&cycleFresh&&swingFresh&&!engineLoop.lastError&&!swingLoop.lastError;
 res.status(ok?200:503).json({ok,service:'MaxIncome',mode:'PAPER',bybitEnvironment,marketDataEnvironment:'BYBIT MAINNET',marketConnected,databaseConnected:db,engineLoop:{running:engineLoop.running,lastStartedAt:engineLoop.lastStartedAt,lastSuccessAt:engineLoop.lastSuccessAt,lastError:engineLoop.lastError?'Falha no ciclo Day Trade.':null},swingLoop:{running:swingLoop.running,lastStartedAt:swingLoop.lastStartedAt,lastSuccessAt:swingLoop.lastSuccessAt,lastError:swingLoop.lastError?'Falha no ciclo Swing.':null},orderExecutionEnabled:false,databaseError:db?null:'Banco indisponível ou não configurado.',timestamp:new Date().toISOString()});
});
app.get('/api/status',(_req,res)=>res.json(publicStatus()));
app.get('/api/paper/status',requireReadToken,async(_req,res)=>{
 try{if(!paperTrader)return res.status(503).json({error:databaseError||'Banco não configurado.'});res.json(await paperTrader.getStatus());}
 catch(e){res.status(503).json({error:'Não foi possível ler o estado PAPER.',detail:e.message});}
});
app.get('/api/swing/status',requireReadToken,async(_req,res)=>{
 try{
  if(!swingPaperTrader)return res.status(503).json({error:databaseError||'Banco PAPER não configurado.'});
  res.json({...swingEngine.getStatus(),paper:await swingPaperTrader.getStatus()});
 }catch(e){res.status(503).json({error:'Estado Swing PAPER indisponível.',detail:e.message});}
});
app.get('/api/refresh',requireReadToken,async(_req,res)=>{
 try{
  if(!paperTrader)return res.status(503).json({error:databaseError||'Banco não configurado.',databaseConnected:false,orderExecutionEnabled:false});
  res.json({...publicStatus(),paper:await paperTrader.getStatus(),swing:{...swingEngine.getStatus(),paper:await swingPaperTrader.getStatus()}});
 }catch(e){res.status(503).json({error:'Estado PAPER indisponível.',detail:e.message,databaseConnected:false,orderExecutionEnabled:false});}
});

app.get('/api/research/backtest',requireReadToken,async(req,res)=>{
 const symbol=String(req.query.symbol||'BTCUSDT').toUpperCase();
 const interval=String(req.query.interval||'240');
 const limit=Number(req.query.limit||500);
 if(!assets.includes(symbol))return res.status(400).json({error:'Ativo não permitido para pesquisa.'});
 if(!['15','60','240','D'].includes(interval))return res.status(400).json({error:'Timeframe inválido; use 15, 60, 240 ou D.'});
 if(!Number.isInteger(limit)||limit<110||limit>1000)return res.status(400).json({error:'Quantidade de candles deve ser um inteiro entre 110 e 1000.'});
 if(!paperTrader)return res.status(503).json({error:'Configuração PAPER indisponível.'});
 try{
  const [candles,paper]=await Promise.all([client.getKlines(symbol,interval,String(limit)),paperTrader.getStatus()]);
  if(candles.length<110)return res.status(422).json({error:'Histórico fechado insuficiente para comparação; são necessários ao menos 110 candles.',received:candles.length});
  const cfg=paper.settings||{};
  const comparison=runStrategyComparisonBacktest(candles,{
   initialCapital:Number(cfg.initial_capital_brl||5000),
   riskPerTrade:Number(cfg.max_risk_per_trade_brl||50),
   stopLossPct:Number(cfg.stop_loss_pct||1),
   feeRatePerSide:Number(cfg.fee_rate_per_side??0.001),
   slippagePct:0.25,
   trainRatio:0.7
  });
  const results=Object.fromEntries(Object.entries(comparison.results).map(([name,result])=>[name,{
   full:result.full.metrics,
   inSample:result.inSample.metrics,
   outOfSample:result.outOfSample.metrics,
   sampleTrades:result.outOfSample.trades.slice(0,20)
  }]));
  return res.json({
   mode:'RESEARCH_ONLY',
   executionEnabled:false,
   symbol,interval,candleCount:comparison.candleCount,
   split:comparison.split,
   assumptions:comparison.results.TREND_FOLLOWING.full.assumptions,
   results
  });
 }catch(error){
  return res.status(502).json({error:'Não foi possível executar o backtest com os dados históricos.'});
 }
});

app.get('/api/balance',requireReadToken,async(_req,res)=>{
 return res.status(410).json({error:'Consulta privada de carteira desativada no simulador PAPER.'});
});
app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(port,'0.0.0.0',async()=>{
 console.log('MaxIncome 2.0 iniciado em PAPER. Execução real desabilitada.');
 const interval=Math.max(15000,Number(process.env.ENGINE_INTERVAL_MS||30000));
 const cycle=async()=>{try{await runCycle();}catch(e){console.error('[Motor Day Trade PAPER]',e.message);}};
 const swingCycle=async()=>{try{await runSwingCycle();}catch(e){console.error('[Motor Swing PAPER]',e.message);}};
 await Promise.all([cycle(),swingCycle()]);
 setInterval(cycle,interval);
 setInterval(swingCycle,swingIntervalMs);
});
