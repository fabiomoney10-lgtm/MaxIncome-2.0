# MaxIncome 2.0 — Etapa 1

Esta entrega é uma base de **monitoramento e análise em Bybit Testnet**.

## Limites intencionais desta etapa
- Usa exclusivamente `https://api-testnet.bybit.com`.
- Não contém chamada de criação de ordem (`/v5/order/create`).
- Não faz compra nem venda, nem mesmo em modo real.
- A estratégia SMA 9/21 gera sinais informativos, não previsões nem garantias.
- Reserva visualmente 6 XRP como patrimônio legado. Não vende nem altera esse saldo.

## Requisitos
- Node.js 18 ou superior.
- Chaves API criadas na Bybit Testnet, com permissão de leitura.
- Não habilite saque ou transferência na API.

## Executar localmente
1. Extraia o ZIP.
2. Copie `.env.example` para `.env`.
3. Preencha `BYBIT_API_KEY` e `BYBIT_SECRET_KEY` localmente. Não envie o `.env` ao GitHub.
4. Execute `npm install`.
5. Execute `npm start`.
6. Abra `http://localhost:10000`.

## Render
Crie um Web Service apontando para este repositório:
- Build Command: `npm install`
- Start Command: `npm start`

Cadastre `BYBIT_API_KEY` e `BYBIT_SECRET_KEY` em Environment no painel do Render. Cadastre também:
- `BYBIT_TESTNET=true`
- `TRADING_MODE=paper`
- `LEGACY_XRP_RESERVED=6`

Não coloque segredos no GitHub, no `render.yaml`, no HTML ou no chat. O Render documenta a configuração de variáveis secretas no painel.

## Próximas etapas antes de qualquer negociação
1. Validar conexão e consistência dos saldos.
2. Persistir estado e histórico em PostgreSQL.
3. Construir paper trading com fills, taxas, saldo virtual e relatório.
4. Testar regras de risco, limites e bloqueio de ativos legados.
5. Só então discutir execução real, com autorização explícita e limites conservadores.

**Não há promessa de lucro. Trading pode gerar perdas.**

## Backtest histórico (somente dados públicos)

Execute `npm run backtest` para comparar a estratégia-base e a estratégia multi-timeframe usando candles públicos spot da Bybit. O relatório apresenta métricas totais, in-sample e out-of-sample, com taxas, slippage e execução conservadora de stop.

Opções:
- `BACKTEST_DAYS=180` (entre 30 e 365 dias).
- `BACKTEST_SYMBOLS=XRPUSDT,BTCUSDT,ETHUSDT,SOLUSDT`.

O resultado financeiro é apresentado em USDT, sem conversão histórica presumida para BRL. O comando não usa credenciais, banco de dados ou endpoints de ordens. Os resultados históricos não garantem desempenho futuro.
