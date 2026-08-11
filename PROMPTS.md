# Prompts relevantes

Este arquivo registra, em forma resumida, os prompts materiais que orientaram a análise, o desenho, o SDD, a implementação e as revisões do mini-projeto. Ele não reproduz instruções internas do ambiente, segredos, credenciais nem conversas sem impacto no resultado.

## 1. Análise do enunciado

> Leia `INSTRUCTIONS.md` como única fonte de requisitos. Separe obrigações, critérios de avaliação, bônus e itens explicitamente fora de escopo. Identifique os três problemas do case — vitrine lenta, overselling e timeout do checkout — e não invente as seis perguntas da Parte 1.A que não foram fornecidas.

Resultado material: definição do fluxo de item único, dos resultados de negócio, do limite incremental da solução e do bloqueio externo da Parte 1.A.

## 2. Escolha de arquitetura

> Proponha a menor arquitetura incremental que retire catálogo e checkout do caminho síncrono do ERP, evite overselling sob concorrência, preserve tentativas durante timeout e continue executável localmente. Compare persistência em memória, PostgreSQL, processamento síncrono, fila real e worker por polling. Mantenha API e web como deployables separados, sem pacote compartilhado.

Resultado material: Next.js/React para a web, NestJS/Fastify para a API, PostgreSQL para transações e locks, monólito modular e worker de concorrência um por polling no banco. O ERP permanece atrás de uma porta substituível e é representado por um simulador determinístico.

## 3. Autoria do SDD

> Converta a arquitetura aprovada em uma especificação `standard` com requisitos funcionais e não funcionais identificados, non-goals, contratos HTTP, modelo de status, invariantes de estoque, algoritmo de idempotência concorrente, comportamento do worker, configuração do simulador, estado da UI, riscos, observabilidade, critérios de aceitação e plano de verificação. Use `spec.md` como fonte de verdade e derive `acceptance.feature` e `tasks.md`.

Resultado material: SDD v0.2 FINAL em `.agent/specs/casecellshop-checkout/`, com rastreabilidade entre `FR-*`, `NFR-*`, `AC-*` e tarefas.

## 4. Revisão do SDD

> Revise o SDD contra `INSTRUCTIONS.md` e procure ambiguidades ou invariantes não demonstráveis. Dê atenção especial à corrida de chaves idempotentes, reserva atômica, determinismo do script ERP, retry após resultado desconhecido, tracking pausado sem novo POST, rollback de falhas e recuperação de pedidos em `PROCESSING`. Não acrescente pagamento, autenticação, ERP real, broker, cloud ou carrinho multi-item.

Resultado material: concorrência da idempotência foi ordenada antes da avaliação de estoque; o script passou a ser finito e determinístico; a UI ganhou política explícita de chave e tracking pausado; um lease/retry automático inseguro do ERP foi rejeitado.

## 5. Implementação orientada por tarefas

Cada prompt de implementação exigiu aderência ao SDD v0.2, preservação da separação entre os deployables e um relatório de evidências e limitações da própria etapa.

| Tarefa | Resumo do prompt material |
|---|---|
| 1 — Fundação | Criar workspace pnpm, configuração validada, PostgreSQL 16, migração, entidades, seed determinístico e suporte de banco de teste isolado. Manter `synchronize: false`. |
| 2 — Catálogo e health | Implementar catálogo local com disponibilidade calculada no SQL e health baseado em `SELECT 1`, sem chamar o simulador ERP no caminho de leitura. |
| 3 — Checkout | Implementar DTOs, envelope de erro, reserva e pedido na mesma transação, claim idempotente antes do estoque e testes de concorrência/rollback contra PostgreSQL real. |
| 4 — Processamento | Implementar consulta de status, porta e simulador ERP, claim `FOR UPDATE SKIP LOCKED`, finalização transacional e limitação explícita para interrupção em `PROCESSING`. |
| 5 — Observabilidade e OpenAPI | Adicionar logs JSON allowlisted e correlacionáveis, instrumentar transições confirmadas e gerar Swagger a partir de controllers/DTOs sem registrar payload, chave ou segredo. |
| 6 — Submissão web | Criar tela acessível de catálogo, seleção e quantidade, cliente HTTP local à web, loading, bloqueio contra clique duplo e mensagens distintas, sem imports da API. |
| 7 — Tracking e retry | Implementar polling abortável, pausa por janela/falhas, retomada GET-only, mesma chave para resultado desconhecido e nova chave após resposta explícita ou falha terminal. |
| 8 — Browser E2E | Orquestrar banco, API e web para três cenários determinísticos: sucesso, falha scripted seguida de retry e tracking pausado retomado sem novo POST. |
| 9 — Documentação | Produzir README em português como entrada do avaliador, registrar prompts materiais, atualizar apenas o status do SDD e separar evidência observada de verificação ainda pendente. |

## 6. Prompts materiais de revisão e reparo

> Compare cada entrega com seu brief e com `spec.md`. Preserve contratos aprovados e corrija a causa, não o sintoma. Não use suppressions, aliases ou pacotes compartilhados para contornar erros.

Esse direcionamento foi aplicado aos seguintes pontos relatados durante a implementação:

- compatibilidade do data source do TypeORM CLI e formato de retorno de `UPDATE` no TypeORM 1.1;
- alinhamento final de Fastify `5.11.0`, `@nestjs/platform-fastify` `^11.1.29` e `@fastify/static` `^10.1.2`, preservando a Swagger UI e removendo vulnerabilidades conhecidas;
- logging Fastify/Pino por um único caminho, com campos allowlisted;
- isolamento e ordem de teardown da suíte web, sem alterar o comportamento de produção;
- ciclo de vida determinístico dos três cenários Playwright com processo novo da API por modo do simulador.

## 7. Restrições preservadas

Os prompts materiais mantiveram estas restrições durante todo o trabalho:

- não criar pagamento, autenticação, integração ERP real, broker de produção, cloud ou carrinho multi-item;
- não alterar o ERP ou seu MySQL;
- não criar pacote comum nem imports cruzados entre `apps/api` e `apps/web`;
- não afirmar resultados que não tenham sido observados;
- não inventar conteúdo para as seis perguntas ausentes da Parte 1.A;
- não incluir segredos, credenciais ou instruções internas neste registro.
