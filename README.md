# MaxIncome 2.0 — monitoramento e simulador PAPER

O sistema monitora dados públicos da Bybit Mainnet e mantém a execução em **PAPER**. O modo atual não envia ordens à corretora.

## Segurança e limites atuais
- Não existe implementação de envio de ordens (`/v5/order/create`) neste projeto.
- `paper_settings.trading_enabled` controla exclusivamente a abertura de posições simuladas no PostgreSQL.
- A coluna não autoriza execução na Bybit. A execução real permanece indisponível e bloqueada.
- A estratégia SMA 9/21 é um filtro simples de tendência, não uma previsão nem garantia de lucro.
- A estratégia Swing é análise; não habilitar abertura automática de posições Swing sem ciclo completo de encerramento e reconciliação.
- O limite de XRP legado é apenas informativo; nenhuma venda automática é realizada.
- Perdas podem ocorrer mesmo em simulação por diferenças entre preço observado, slippage e execução real.

## Requisitos
- Node.js 18 ou superior.
- PostgreSQL/Supabase configurado em `DATABASE_URL`.
- Não habilite saque ou transferência em nenhuma chave API. O simulador atual não precisa de chave privada da Bybit.

## Executar localmente
1. Copie `.env.example` para `.env`.
2. Configure `DATABASE_URL` localmente; nunca envie segredos ao GitHub.
3. Execute `npm install`.
4. Execute `npm test`.
5. Execute `npm start` e abra `http://localhost:10000`.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Configure `DATABASE_URL` em Environment.
- Mantenha `BYBIT_ENV=testnet` enquanto o endpoint privado não fizer parte do escopo.
- Não cadastre credenciais de produção para este modo.

## Habilitar somente a simulação
Depois de aplicar a migration `supabase/migrations/202611180001_allow_paper_simulation_switch.sql`, a simulação pode ser habilitada no banco:

```sql
UPDATE public.paper_settings
SET trading_enabled = true, updated_at = now()
WHERE id = 1;
```

Isso permite apenas criar registros de posições PAPER. Para pausar:

```sql
UPDATE public.paper_settings
SET trading_enabled = false, updated_at = now()
WHERE id = 1;
```

## Antes de qualquer operação com dinheiro real
Ainda seria necessário desenvolver e auditar um módulo separado de execução real, incluindo regras de precisão e lote da corretora, ordens idempotentes, confirmação de fills parciais, stop/target hospedados na corretora, reconciliação após falhas, testes na Testnet e aprovação explícita. Nenhum desses recursos deve ser presumido como pronto.

**Não há promessa de lucro. Não use este projeto como robô de dinheiro real enquanto a execução real não existir e passar por validação independente.**