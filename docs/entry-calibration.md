# MaxIncome 2.0 — pesquisa e calibração de estratégias

## Escopo e segurança

Esta branch é exclusivamente de pesquisa. Não altera o motor ativo, `src/strategy.js`, `src/paper-trader.js`, `src/risk-guards.js`, parâmetros ativos, banco, secrets, variáveis do Render ou execução de ordens. Não habilita `trading_enabled`; PAPER e `orderExecutionEnabled=false` permanecem obrigatórios. Não fazer merge/deploy sem revisão e autorização.

## Estratégias comparadas

O backtest executável compara cinco regras long-only pré-definidas:
1. Baseline SMA 9/21.
2. Tendência SMA 20/50 com inclinação positiva.
3. Momentum de 20 candles (mínimo +1,5% e preço acima da SMA20).
4. Rompimento da máxima dos 20 candles anteriores, com filtro ATR e volume.
5. Reversão à média apenas em regime lateral, RSI <= 30 e preço abaixo da banda inferior.

Os indicadores usam somente candles fechados até o candle do sinal. Os sinais são hipóteses fixas, não promessas de lucro. RSI usa média simples de ganhos/perdas (não Wilder). O módulo de diagnóstico `src/research-strategies.js` permanece isolado e não é importado pelo PaperTrader.

## Dados históricos reproduzíveis

O comando `npm run research:backtest` executa `scripts/run-research-backtest.js`:
- Consulta a API pública Bybit V5, categoria `spot`, intervalo de 15 minutos, para XRPUSDT, BTCUSDT, ETHUSDT e SOLUSDT.
- Busca aproximadamente 365 dias, pagina até cobrir a janela, ordena cronologicamente, remove duplicatas e exclui candles ainda abertos.
- Falha se houver erro de API, candles OHLCV inválidos ou menos de 500 candles por ativo; não substitui a fonte silenciosamente.
- Registra páginas, quantidade bruta, duplicatas, candles descartados por ainda estarem abertos, lacunas estimadas, primeiro/último timestamp e SHA-256 de cada CSV.
- Salva candles, qualidade dos dados, resumo CSV e relatório JSON em `artifacts/research/`.

Fonte e contrato da API: Bybit V5 Get Kline, endpoint `GET /v5/market/kline`. A resposta é ordenada do candle mais recente para o mais antigo; o limite por página é 1.000 e os timestamps são em milissegundos. O coletor reordena e deduplica antes de testar. 

## Protocolo temporal e execução

- Divisão cronológica fixa: 60% treino, 20% validação e 20% teste; nunca embaralhar.
- 50 candles anteriores são usados apenas como aquecimento dos indicadores no início de cada partição; não geram trades nessa partição.
- Sinal é confirmado no fechamento do candle; entrada simulada somente na abertura do candle seguinte.
- Stop de 1% e alvo de 4,2%, iguais entre as estratégias e ativos nesta rodada.
- Se stop e alvo forem tocados no mesmo candle, stop tem prioridade.
- Gaps no stop são executados de forma adversa; liquidação no fim da partição inclui slippage e taxa de saída.
- Capital virtual de 5.000 USDT e orçamento máximo de risco de 50 USDT por operação. Resultados são em USDT; não há conversão histórica USDT/BRL.
- Cenário-base: taxa 0,10% por lado e slippage 0,25% por lado.
- Cenário de estresse: taxa 0,20% por lado e slippage 0,50% por lado.
- O dimensionamento considera stop, taxa e slippage dos dois lados.

## Métricas

Por ativo, partição, estratégia e cenário, o relatório inclui número de operações, ganhos/perdas, taxa de acerto, P&L líquido em USDT, capital final, expectativa por operação, profit factor, drawdown máximo, taxas totais e saídas por stop/alvo/fim de amostra.

## Limitações desta primeira rodada

- O drawdown é marcado por fechamento de candle e resultados realizados; não representa drawdown intrabar de uma carteira multiativo.
- Não há dados históricos de spread/livro de ofertas; slippage é uma hipótese fixa, testada em dois níveis.
- Não há funding, pois o estudo é spot.
- Não há benchmark buy-and-hold, entradas aleatórias, bootstrap, intervalos de confiança ou walk-forward móvel nesta primeira execução.
- Cada partição começa com capital virtual independente e liquida eventual posição aberta no fim da janela. Os resultados entre partições não devem ser somados como se fossem uma única carteira contínua.
- A divisão 60/20/20 é uma primeira auditoria temporal; os parâmetros não foram otimizados no treino nem selecionados na validação. O teste final permanece uma verificação fora da amostra para estas regras fixas.

## Critérios para interpretação

Não escolher uma estratégia apenas pelo maior lucro no treino. Dar prioridade ao teste final e à estabilidade por ativo, validação e cenário de estresse. Profit factor acima de 1 isoladamente não é suficiente: exigir amostra razoável, expectativa líquida positiva em mais de um ativo/janela, drawdown compatível com o risco e resiliência a custos maiores. Se poucas operações ocorrerem, classificar como inconclusivo.

Mesmo um backtest positivo não garante resultado futuro. Nenhum resultado desta branch autoriza ordens reais. Manter PAPER até auditoria independente, observação prospectiva e autorização explícita.

## Testes e automação

O workflow Research CI instala dependências, verifica sintaxe e executa `npm test`. A coleta histórica é uma execução separada: os runners hospedados do GitHub podem sair por IP dos Estados Unidos, que a Bybit bloqueia com HTTP 403. Execute `npm run research:backtest` em um computador/ambiente cuja origem seja autorizada pela Bybit (para conta internacional brasileira, a documentação indica `api.bybit.com`). O comando gera CSVs históricos, hashes SHA-256, qualidade dos dados, resumo CSV e relatório JSON em `artifacts/research/`. Não use proxy nem altere a origem para contornar restrição geográfica.

Os testes sintéticos verificam temporalidade, custos dos dois lados, prioridade do stop, validação OHLCV e bloqueio de execução. Eles não provam rentabilidade.
