# MaxIncome 2.0 — Etapa 1

Esta entrega é uma base de **monitoramento e análise em Bybit Testnet**.

## Limites de segurança
- Usa exclusivamente `https://api-testnet.bybit.com`.
- O cliente Bybit aceita somente endpoints GET de leitura previamente autorizados.
- Qualquer método diferente de GET ou endpoint não permitido é bloqueado no próprio cliente.
- Não contém chamada de criação de ordem (`/v5/order/create`).
- Não faz compra nem venda, nem mesmo em modo real.
- A estratégia SMA 9/21 gera sinais informativos, não previsões nem garantias.
- Reserva visualmente 6 XRP como patrimônio legado. Não vende nem altera esse saldo.

## Requisitos
- Node.js 18 ou superior.
- Chaves API criadas na Bybit Testnet, com permissão de leitura.
- Não habilite saque ou transferência na API.

## Configuração local
1. Copie `.env.example` para `.env`.
2. Preencha as variáveis localmente. Nunca envie `.env` ao GitHub.
3. Execute `npm install` e depois `npm start`.
4. Abra `http://localhost:10000`. O navegador solicitará usuário e senha do painel.

## Render
Cadastre estas variáveis em Environment no painel do Render:
- `BYBIT_API_KEY` e `BYBIT_SECRET_KEY` (chaves da Testnet, leitura apenas)
- `BYBIT_TESTNET=true`
- `TRADING_MODE=paper`
- `DASHBOARD_USER` e `DASHBOARD_PASSWORD` (credenciais fortes e exclusivas para o painel)
- `LEGACY_XRP_RESERVED=6`

O serviço falha de forma fechada para o painel e para as rotas privadas se usuário e senha não estiverem configurados. O endpoint `/api/health` permanece público para health checks e não retorna dados de conta.

Não coloque segredos no GitHub, no `render.yaml`, no HTML ou no chat. Configure-os somente no painel do Render ou no arquivo `.env` local, que não deve ser versionado.

## Proteções adicionadas
- Autenticação HTTP Basic para o painel e todas as rotas privadas.
- Comparação de credenciais em tempo constante.
- Bloqueio temporário após 10 tentativas incorretas em 15 minutos (por endereço de origem).
- Cabeçalhos de segurança, política de conteúdo e respostas privadas sem cache.
- Respostas HTTP não expõem detalhes internos de erros da corretora.
- Cliente Bybit restrito a endpoints GET de leitura da Testnet.

## Próximas etapas
1. Validar conexão e consistência dos saldos.
2. Persistir estado e histórico em PostgreSQL.
3. Construir paper trading com fills simulados, taxas, saldo virtual e relatório.
4. Testar regras de risco, limites e bloqueio de ativos legados.

**Não há promessa de lucro. Trading pode gerar perdas.**
