'use strict';
const { analyzeCandles } = require('./strategy');
const { RiskManager } = require('./risk-manager');

class TradingEngine {
  constructor({ client, assets, legacyXrpReserved, maxRiskBRL, maxDailyLossBRL, maxTradesPerDay, maxExposureBRL, stopLossPct, takeProfitPct }) {
    this.client=client; this.assets=assets;
    this.risk=new RiskManager({legacyXrpReserved,maxRiskBRL,maxDailyLossBRL,maxTradesPerDay,maxExposureBRL,stopLossPct,takeProfitPct});
    this.state={mode:'PAPER',environment:client.tradingEnvironment||client.environment,marketDataEnvironment:client.marketDataEnvironment||'BYBIT MAINNET',orderExecutionEnabled:false,updatedAt:null,connected:false,balance:null,assets:{},log:['Sistema iniciado em PAPER. Nenhuma ordem será enviada à corretora.'],error:null};
    this.running=false;
  }
  addLog(message){this.state.log.unshift('['+new Date().toLocaleString('pt-BR')+'] '+message);this.state.log=this.state.log.slice(0,30);}
  async runOnce(){
    if(this.running)return;
    this.running=true;
    try{
      const rows=await Promise.all(this.assets.map(async symbol=>{
        try{
          const [ticker,candles]=await Promise.all([this.client.getTicker(symbol),this.client.getKlines(symbol)]);
          const analysis=analyzeCandles(candles);
          return [symbol,{...ticker,...analysis,risk:this.risk.evaluate({signal:analysis.signal,usdtBalance:null})}];
        }catch(err){return [symbol,{error:err.message,signal:'INSUFFICIENT_DATA'}];}
      }));
      this.state.assets=Object.fromEntries(rows);
      this.state.connected=rows.some(([,v])=>Number.isFinite(Number(v.lastPrice)));
      this.state.updatedAt=new Date().toISOString();
      this.state.error=this.state.connected?null:'Nenhum ativo retornou dados válidos.';
      this.addLog('Dados públicos: '+(this.client.marketDataEnvironment||'BYBIT MAINNET')+'. Ambiente privado configurado: '+(this.client.tradingEnvironment||this.client.environment)+'. PAPER ativo; ordens reais bloqueadas.');
      if(!this.state.connected)throw new Error(this.state.error);
    }catch(err){this.state.connected=false;this.state.error=err.message;this.addLog('Falha de sincronização: '+err.message);throw err;}
    finally{this.running=false;}
  }
  getStatus(){return {...this.state,legacyXrpReserved:this.risk.legacyXrpReserved,riskLimits:this.risk.getLimits(),botXrpAvailable:null};}
}
module.exports={TradingEngine};
