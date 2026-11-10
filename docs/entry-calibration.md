# MaxIncome 2.0 — plano de calibração e validação

## Estado confirmado no código (base de referência)
- Day trade usa SMA 9/21 em candles de 15 minutos: compra candidata quando SMA9 > SMA21 e o fechamento está acima da SMA9; venda/short não é implementada.
- O ciclo PAPER abre posição apenas com sinal BULLISH e somente quando `paper_settings.trading_enabled === true`. O painel atual reportou o interruptor global desligado. Não altere esse interruptor.
- Swing é apenas análise: combina tendência diária/4h, rompimento, pullback e força relativa; o próprio status informa `paperPositionsEnabled:false`.
- As taxas padrão são 0,1% por lado. O cálculo de risco do day trade também inclui buffer de slippage de 0,25%.
- O alvo dinâmico atual tenta assegurar 2:1, mas a fórmula não desconta explicitamente slippage adverso no alvo. Isso precisa ser comparado com custos completos; não presumir que a relação líquida efetiva seja 2:1.
- O histórico previamente informado tem somente duas perdas (XRP e ETH, total -R$65,24). Duas operações não permitem estimar vantagem estatística.

## O que foi acrescentado nesta branch
Um backtester isolado para candles OHLC:
- sinal no fechamento e entrada na abertura do candle seguinte (evita look-ahead);
- stop/target intrabar; se ambos forem tocados no mesmo candle, assume stop primeiro;
- taxa e slippage adverso cobrados na entrada e na saída;
- P&L líquido, profit factor, taxa de acerto e drawdown máximo;
- testes automatizados com dados sintéticos.

O backtester não participa do motor ao vivo, não grava no banco, não envia ordens e não muda parâmetros de produção.

## Limitações antes de chamar o resultado de satisfatório
1. Testes sintéticos verificam o cálculo, não provam rentabilidade.
2. Para resultado empírico, executar `npm test` e coletar candles históricos Bybit para XRPUSDT, BTCUSDT, ETHUSDT e SOLUSDT, preservando timestamp e OHLC.
3. Separar cronologicamente treino, validação e teste fora da amostra; comparar SMA 9/21 com alternativas predefinidas sem escolher parâmetros olhando o teste final.
4. Testar períodos de alta, baixa e lateralização; incluir taxa 0,1% por lado e slippage 0,25% por lado como cenário-base e cenários de estresse.
5. Reportar número de operações, lucro líquido, profit factor, drawdown, expectativa por trade, exposição temporal e sensibilidade a custos. Não aprovar estratégia com amostra pequena ou poucos negócios.
6. Não ajustar thresholds para aumentar artificialmente frequência. Não fazer merge/deploy até revisão dos resultados e dos testes.

## Segurança
Esta branch é pesquisa apenas. Manter PAPER, `trading_enabled=false`, `orderExecutionEnabled=false`; não alterar secrets, variáveis Render, banco ou o serviço antigo `maxincome-backend` em Oregon.
