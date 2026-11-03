# MaxIncome — segurança de execução Spot

## Estado desta etapa

Esta branch adiciona somente uma pré-validação de risco isolada. Ela **não envia ordens** e não habilita produção. O modo padrão do produto continua PAPER.

## Limites de referência

- Capital de referência: R$ 5.000.
- Risco máximo planejado por operação: R$ 50.
- Perda realizada máxima por dia: R$ 100.
- Até 5 operações por dia.
- Exposição agregada máxima: R$ 5.000 (não pode exceder o capital de referência).
- Spot sem margem: `category=spot` e `isLeverage=0`.

Os limites são parâmetros de proteção, não metas de retorno. O saldo real e a taxa BRL/USDT precisam ser consultados e validados antes de dimensionar uma ordem.

## Regras de bloqueio

A pré-validação nega a operação quando:
- o modo real e o acknowledgement explícito não estão ativos;
- o produto não é Spot ou `isLeverage` não é zero;
- símbolo não termina em USDT;
- preço, stop ou alvo são inválidos;
- saldo, taxa de câmbio, taxa da corretora ou slippage não são dados válidos;
- o limite diário de perda, de quantidade de operações ou de exposição foi atingido;
- o tamanho calculado fica abaixo do mínimo informado pela corretora.

O tamanho é calculado usando distância entre entrada e stop, duas incidências de taxa e slippage estimado. O resultado é limitado por saldo disponível e exposição restante.

## O que ainda é obrigatório antes de ordens reais

1. Buscar os filtros oficiais de cada instrumento (tick size, qty step, min order amount) e arredondar para baixo.
2. Obter taxa real da conta e taxa BRL/USDT de fonte confiável; falhar fechado se indisponíveis/desatualizadas.
3. Implementar cliente de produção separado, assinatura V5 para GET/POST e allowlist estrita de endpoints.
4. Para Spot, criar ordem Limit com stop-loss/take-profit anexados quando suportado; não tratar aceite HTTP como fill.
5. Confirmar fills, taxas e ordens condicionais via consulta/stream; reconciliar após reinício e timeout para evitar duplicidade.
6. Persistir trades, exposição e perda diária em banco transacional antes de permitir nova ordem.
7. Implementar kill switch, pausa em falhas, proteção contra dados atrasados, idempotência e limites por símbolo.
8. Testar integralmente na Testnet com cenários de rejeição, fill parcial, timeout, desconexão, gaps e cancelamento.
9. Só então fazer revisão final e exigir autorização explícita para ativar REAL no Render.

**Não colocar chaves API no GitHub, no código, em arquivos .env versionados ou no chat. A chave de produção deve ser Spot Trade apenas, sem saque/transferência, configurada diretamente no Render.**
