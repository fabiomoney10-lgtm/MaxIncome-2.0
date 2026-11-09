# Laboratório de estratégias do MaxIncome 2.0

## Objetivo

O laboratório compara três hipóteses sistemáticas em dados públicos da Bybit:

- **Trend following:** tendência de alta, rompimento de máxima recente e RSI em faixa de força.
- **Momentum:** tendência de alta, preço acima da SMA 20, RSI e confirmação de volume quando disponível.
- **Mean reversion:** mercado classificado como lateral, RSI em sobrevenda e recuperação do RSI.

O classificador também identifica tendência de baixa e volatilidade elevada. O motor é long-only para spot; não abre posições vendidas.

## Regras de segurança

- Diagnóstico e backtest são exclusivamente de pesquisa.
- `executionEnabled` permanece `false`; o laboratório não chama endpoints de ordem.
- O endpoint de backtest exige o token privado de leitura.
- Somente ativos configurados em `ASSETS` e timeframes 15m, 1h, 4h e diário são aceitos.
- O histórico precisa conter pelo menos 110 candles fechados; o máximo por consulta é 1000.
- Nenhum resultado do backtest altera `trading_enabled`, risco diário ou configurações do PaperTrader.

## Como executar

No painel principal, conecte com o token privado de leitura, selecione ativo/timeframe e clique em **Comparar estratégias**.

O endpoint `GET /api/research/backtest?symbol=BTCUSDT&interval=240&limit=500` executa três comparações independentes. A divisão padrão é 70% para amostra inicial e 30% para teste fora da amostra. Os indicadores do teste usam apenas candles disponíveis até cada sinal; a entrada simulada acontece na abertura do candle seguinte.

## Custos e premissas

O backtest usa os parâmetros PAPER persistidos no banco para capital, risco por operação, stop e taxa por lado; slippage é fixado em 0,25% por lado. O alvo padrão é calculado para buscar uma relação líquida modelada de 2:1 após taxas e slippage. Se stop e alvo forem tocados no mesmo candle, assume-se stop primeiro.

Métricas apresentadas: quantidade de trades, taxa de acerto, PnL bruto, taxas, PnL líquido, capital final, retorno, drawdown máximo sobre operações encerradas, profit factor e expectativa por trade.

## Limitações conhecidas

- Heurísticas ainda não calibradas nem validadas como vantagem estatística.
- RSI usa média simples de ganhos/perdas, não a suavização de Wilder.
- Drawdown não inclui oscilações intratrade.
- Não modela spread, profundidade do livro, impacto de mercado, latência, gaps de liquidez ou concorrência entre ativos.
- Cada ativo/timeframe é testado separadamente; os resultados não representam um portfólio com posições simultâneas.
- O período fora da amostra não substitui walk-forward com múltiplas janelas e diferentes regimes.
- Histórico curto ou resultados com poucas operações não sustentam conclusões.

**Nenhum resultado histórico garante rentabilidade futura.** Antes de qualquer decisão operacional, serão necessários dados mais longos, validação walk-forward, análise de sensibilidade de custos e acompanhamento PAPER por um período definido.
