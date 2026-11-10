# MaxIncome 2.0 — plano de calibração e validação

## Escopo e segurança

Esta branch é exclusivamente de pesquisa. Não altera `src/strategy.js`, `src/paper-trader.js`, `src/risk-guards.js`, parâmetros ativos, banco, secrets, variáveis do Render ou execução de ordens. Não habilita `trading_enabled`; PAPER e `orderExecutionEnabled=false` permanecem obrigatórios. Não fazer merge/deploy sem revisão e autorização.

## Estratégia ativa de referência

- Day trade é long-only e usa SMA 9/21 em candles fechados de 15 minutos: sinal candidato quando SMA9 > SMA21 e fechamento > SMA9.
- O sinal é uma condição de pesquisa, não uma previsão de lucro.
- Swing é um motor de análise separado; seus sinais e limites não devem ser misturados com os resultados do Day Trade.
- Taxa de referência: 0,1% por lado. Buffer de risco atual: 0,25% para slippage/gap. O buffer de risco não substitui a modelagem de fill no backtest.
- O histórico PAPER previamente reconciliado contém duas perdas, XRP e ETH, totalizando -R$65,24. Duas operações não permitem inferir vantagem estatística.

## Correções no backtester desta branch

- O sinal SMA é calculado incluindo o fechamento do candle de sinal, que é a informação disponível no momento da decisão.
- A entrada ocorre somente na abertura do candle seguinte, com slippage adverso.
- Uma posição não é testada contra máxima/mínima de candle anterior à sua entrada.
- Drawdown não marca uma posição futura contra o fechamento anterior ao fill. A marcação começa no candle da entrada.
- Saída por stop usa execução conservadora em gaps; se stop e alvo forem tocados no mesmo candle, stop tem prioridade.
- Taxa e slippage são aplicados separadamente na entrada e na saída. O relatório expõe os valores de taxa de cada lado por trade, custos totais e expectativa líquida por trade.
- Liquidação no fim da amostra inclui slippage e taxa de saída.
- Drawdown reportado é close-to-close após entrada, acrescido dos resultados realizados no encerramento. Não é drawdown intrabar de carteira multiativo.

## Testes de regressão

A suíte deve comprovar, com candles sintéticos:
1. Sinal com dados disponíveis até o fechamento atual e entrada na abertura seguinte.
2. Alterar candles posteriores não modifica uma operação já encerrada.
3. Taxa e slippage cobrados individualmente nos dois lados.
4. Stop-first quando stop e alvo são tocados no mesmo candle.
5. Drawdown não marcado antes do candle efetivo de entrada.
6. Validação de OHLC e parâmetros numéricos inválidos.

Testes sintéticos verificam a mecânica; não provam rentabilidade.

## Metodologia para procurar robustez (não prometer lucro constante)

### Hipóteses pré-registradas
Comparar apenas regras simples e previamente definidas:
- Baseline SMA 9/21.
- Trend following SMA 20/50 com filtro de inclinação.
- Momentum de 20 períodos com limiar de não negociação.
- Breakout de 20 períodos com filtro de volatilidade ATR.
- Mean reversion somente em regime lateral identificado sem dados futuros.

Não otimizar dezenas de combinações. Manter o mesmo conjunto de parâmetros em todos os ativos durante cada rodada e registrar qualquer alteração como nova hipótese.

### Filtros de qualidade
- Regime: tendência, lateralização e volatilidade elevada classificados usando somente candles fechados.
- Volatilidade: ATR percentual para dimensionar risco; bloquear quando o stop necessário exceder o orçamento ou quando a volatilidade estiver fora da faixa definida no treino.
- Custos: exigir retorno esperado estimado maior que taxa + slippage + margem de segurança antes de abrir operação.
- Volume/força relativa: usar apenas se a fonte histórica for consistente e os campos estiverem disponíveis; ausência de volume não pode virar confirmação artificial.
- Sem sinal: ficar em caixa é uma decisão válida. Não aumentar frequência para recuperar perdas.

### Protocolo cronológico obrigatório
1. Treino: primeira janela cronológica para formular e selecionar entre hipóteses pré-registradas.
2. Validação: janela seguinte para escolher no máximo uma configuração por regra, sem consultar o teste final.
3. Teste final: janela mais recente, intocada até congelar código, custos e parâmetros.
4. Walk-forward: repetir seleção em janelas móveis e concatenar somente retornos fora da amostra.
5. Purge/embargo: quando posições ou rótulos atravessarem limites entre janelas, remover observações sobrepostas e aplicar intervalo de segurança.
6. Robustez: repetir com custos-base e custos dobrados; atrasar execução em um candle; testar por ativo, timeframe e regime.
7. Estatística: bootstrap em blocos para intervalos de confiança e correção de seleção múltipla/Deflated Sharpe quando houver número suficiente de variantes.

### Dados e métricas
- Preferir candles históricos públicos da Bybit para XRPUSDT, BTCUSDT, ETHUSDT e SOLUSDT.
- Guardar origem, timeframe, timestamp UTC, paginação, parâmetros, hash dos arquivos e contagem de lacunas/duplicatas.
- Não misturar dados de outra corretora como se fossem Bybit. Se fallback for necessário, identificar claramente e executar como experimento separado.
- Modelar taxa, slippage, spread, gaps e, quando aplicável, funding; spot long-only não deve incluir funding de perpétuos.
- Reportar por ativo/timeframe e consolidado: número de trades, P&L líquido, profit factor, expectativa/trade, drawdown, exposição temporal, turnover, taxa de acerto, duração e intervalos de confiança.
- Comparar com caixa, buy-and-hold e entradas aleatórias com as mesmas regras de saída e custos.

## Critérios mínimos antes de qualquer recomendação operacional

Não basta lucro agregado positivo. Exigir amostra suficiente, expectativa líquida positiva em múltiplas janelas fora da amostra, profit factor acima de 1 após custos, drawdown compatível com o limite, estabilidade entre ativos/regimes e sobrevivência ao cenário de custos dobrados e atraso de execução. Os limites numéricos devem ser definidos antes do teste final, não escolhidos depois de ver os resultados.

Mesmo se esses critérios forem atingidos, manter PAPER por um período adicional de observação. Nenhum backtest garante resultado futuro.

## Pendências

- Executar `npm test` e todos os workflows desta branch.
- Obter candles históricos Bybit sem substituir silenciosamente a fonte.
- Implementar e auditar a divisão treino/validação/teste e walk-forward com janelas múltiplas.
- Adicionar spread/impacto ou declarar claramente a limitação se os dados de livro não estiverem disponíveis.
- Comparar as hipóteses pré-registradas e publicar artefatos reproduzíveis antes de qualquer alteração operacional.
