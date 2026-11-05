'use strict';
const express=require('express');
const path=require('path');
const crypto=require('crypto');
const {BybitClient}=require('./src/bybit');
const {TradingEngine}=require('./src/trading-engine');
const {createPool,PaperTrader}=require('./src/paper-trader');

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
let pool=null,paperTrader=null,databaseError=null;
try{
 pool=createPool(process.env.DATABASE_URL||'');
 paperTrader=new PaperTrader({pool,assets,stopLossPct:process.env.PAPER_STOP_LOSS_PCT||1,feeRatePerSide:process.env.PAPER_FEE_RATE_PER_SIDE||0.001});
}catch(e){databaseError=e.message;}
async function runCycle(){
 await engine.runOnce();
 if(!paperTrader)throw new Error(databaseError||'DATABASE_URL não configurada.');
 await paperTrader.runOnce(engine.getStatus().assets||{});
}
function publicStatus(){
 const s=engine.getStatus();
 const {balance,botXrpAvailable,...safe}=s;
 return {...safe,balanceAvailable:false};
}
app.get('/api/health',async(_req,res)=>{
 let db=false;
 try{if(pool){await pool.query('SELECT 1');db=true;}}catch(e){databaseError=e.message;}
 res.status(db?200:503).json({ok:db,service:'MaxIncome',mode:'PAPER',bybitEnvironment,databaseConnected:db,orderExecutionEnabled:false,databaseError:db?null:databaseError,timestamp:new Date().toISOString()});
});
app.get('/api/status',(_req,res)=>res.json(publicStatus()));
app.get('/api/paper/status',async(_req,res)=>{
 try{if(!paperTrader)return res.status(503).json({error:databaseError||'Banco não configurado.'});res.json(await paperTrader.getStatus());}
 catch(e){res.status(503).json({error:'Não foi possível ler o estado PAPER.',detail:e.message});}
});
app.get('/api/refresh',async(_req,res)=>{
 try{await runCycle();res.json({...publicStatus(),paper:await paperTrader.getStatus()});}
 catch(e){res.status(503).json({error:'Motor PAPER bloqueado ou indisponível.',detail:e.message,databaseConnected:Boolean(pool&&!databaseError),orderExecutionEnabled:false});}
});
app.get('/api/balance',async(req,res)=>{
 const expected=process.env.MAXINCOME_READ_TOKEN||'';
 const supplied=(req.get('authorization')||'').replace(/^Bearer\\s+/i,'');
 const a=Buffer.from(expected),b=Buffer.from(supplied);
 if(!expected||a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Acesso não autorizado.'});
 return res.status(410).json({error:'Consulta privada de carteira desativada no simulador PAPER.'});
});
app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(port,'0.0.0.0',async()=>{
 console.log('MaxIncome 2.0 iniciado em PAPER. Execução real desabilitada.');
 const interval=Math.max(15000,Number(process.env.ENGINE_INTERVAL_MS||30000));
 const cycle=async()=>{try{await runCycle();}catch(e){console.error('[Motor PAPER]',e.message);}};
 await cycle();
 setInterval(cycle,interval);
});
