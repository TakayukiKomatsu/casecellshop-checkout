@final @casecellshop
Feature: Checkout resiliente da CaseCellShop
  Os cenários são derivados de spec.md versão 0.2.

  Background:
    Given o PostgreSQL foi migrado e possui o catálogo seed
    And o worker permanece parado até o cenário iniciá-lo

  @fr-1 @ac-1
  Scenario: Listar produtos sem depender do ERP simulado
    Given o simulador ERP está bloqueado
    When o cliente consulta GET /api/products
    Then a API responde 200 com os produtos seed
    And cada produto contém priceCents e availableStock
    And nenhuma chamada ao simulador ERP é iniciada

  @fr-2 @fr-4 @ac-2
  Scenario: Aceitar pedido e reservar estoque atomicamente
    Given um produto possui stock_on_hand 5 e stock_reserved 0
    When o cliente envia quantidade 2 com uma nova chave de idempotência
    Then a API responde 202 com Location e um pedido PENDING
    And existe exatamente um pedido persistido
    And o produto possui stock_on_hand 5 e stock_reserved 2

  @fr-3 @ac-3
  Scenario Outline: Rejeitar quantidade inválida sem mutação
    Given um produto com estoque disponível
    When o cliente envia a quantidade <quantity>
    Then a API responde 400 com code VALIDATION_ERROR
    And nenhum pedido é criado
    And o estoque permanece inalterado

    Examples:
      | quantity |
      | 0        |
      | -1       |
      | 1.5      |
      | "2"      |
      | null     |
      | 9007199254740992 |

  @fr-3 @ac-3
  Scenario: Rejeitar identificadores inválidos
    When o cliente envia productId ou Idempotency-Key que não é UUID
    Then a API responde 400 com code VALIDATION_ERROR
    And nenhum pedido ou reserva é criado

  @fr-3 @ac-3
  Scenario: Rejeitar campos obrigatórios ausentes
    When o cliente omite Idempotency-Key, productId ou quantity
    Then a API responde 400 com code VALIDATION_ERROR
    And nenhum pedido, reserva ou registro de idempotência é criado

  @fr-3 @ac-3
  Scenario: Rejeitar UUID de pedido malformada
    When o cliente consulta GET /api/orders/not-a-uuid
    Then a API responde 400 com code VALIDATION_ERROR

  @fr-4 @ac-4
  Scenario: Rejeitar estoque insuficiente
    Given um produto possui availableStock 1
    When o cliente solicita quantidade 2 com nova chave
    Then a API responde 409 com code INSUFFICIENT_STOCK
    And details.availableStock é 1
    And nenhum pedido ou reserva é criado

  @fr-4 @nfr-1 @ac-5 @concurrency
  Scenario: Impedir overselling sob concorrência
    Given um produto possui exatamente uma unidade disponível
    When duas requisições concorrentes usam chaves diferentes e solicitam uma unidade
    Then exatamente uma requisição responde 202
    And exatamente uma requisição responde 409 com code INSUFFICIENT_STOCK
    And existe exatamente um pedido reservado
    And stock_on_hand é 1
    And stock_reserved é 1

  @fr-5 @ac-6
  Scenario: Reproduzir tentativa duplicada sem nova reserva
    Given um pedido foi aceito para productId e quantity
    When o mesmo request é repetido com a mesma chave de idempotência
    Then a API responde 200
    And replayed é true
    And o ID do pedido é o mesmo
    And nenhuma reserva adicional é criada

  @fr-5 @ac-6 @concurrency
  Scenario: Consolidar tentativas duplicadas concorrentes
    Given um produto possui exatamente a quantidade solicitada disponível
    When duas requisições concorrentes usam a mesma chave e o mesmo request
    Then exatamente uma requisição responde 202 com replayed false
    And exatamente uma requisição responde 200 com replayed true
    And ambas observam o mesmo ID de pedido
    And existe exatamente um pedido
    And existe exatamente uma reserva para sua quantidade

  @fr-5 @ac-7
  Scenario: Rejeitar reutilização da chave com conteúdo diferente
    Given uma chave já criou pedido para quantidade 1
    When a mesma chave é enviada para quantidade 2
    Then a API responde 409 com code IDEMPOTENCY_KEY_REUSED
    And o pedido e a reserva originais permanecem inalterados

  @fr-3 @ac-23
  Scenario: Rejeitar produto inexistente sem mutação
    Given uma UUID válida não identifica um produto
    When o cliente cria pedido para essa UUID
    Then a API responde 404 com code PRODUCT_NOT_FOUND
    And nenhum pedido, reserva ou registro de idempotência é persistido

  @fr-3 @fr-4 @ac-24
  Scenario: Reverter falha técnica antes do commit
    Given uma falha de infraestrutura é injetada após a reserva e antes do commit
    When o cliente cria um pedido válido
    Then a API responde 500 com code INTERNAL_ERROR e correlationId
    And nenhum pedido, reserva ou registro de idempotência é persistido

  @fr-6 @nfr-2 @ac-8
  Scenario: Não aguardar o ERP no request de checkout
    Given o worker está ativo e o simulador ERP não conclui até ser liberado pelo teste
    When o cliente cria um pedido válido
    Then a API responde 202 enquanto o simulador permanece bloqueado
    And o pedido pode ser consultado como PENDING ou PROCESSING

  @fr-7 @ac-11
  Scenario Outline: Consultar cada estado persistido
    Given existe um pedido persistido em <status> com <failureCode>
    When o cliente consulta GET /api/orders/{id}
    Then a API responde 200 com status <status>
    And a resposta contém failureCode <failureCode>

    Examples:
      | status     | failureCode          |
      | PENDING    | null                 |
      | PROCESSING | null                 |
      | COMPLETED  | null                 |
      | FAILED     | TEMPORARY_ERP_FAILURE |

  @fr-7 @ac-11
  Scenario: Consultar pedido inexistente
    Given não existe pedido para uma UUID válida
    When o cliente consulta GET /api/orders/{id}
    Then a API responde 404 com code ORDER_NOT_FOUND

  @fr-8 @fr-11 @ac-9
  Scenario: Concluir processamento com sucesso
    Given o simulador está em modo success
    And um pedido de quantidade 2 está reservado
    When o worker processa o pedido
    Then o pedido se torna COMPLETED
    And stock_on_hand diminui em 2
    And stock_reserved diminui em 2
    And a finalização ocorre exatamente uma vez

  @fr-8 @fr-11 @ac-10
  Scenario: Liberar reserva em falha temporária
    Given o simulador está em modo failure
    And um pedido de quantidade 2 está reservado
    When o worker processa o pedido
    Then o pedido se torna FAILED
    And failureCode é TEMPORARY_ERP_FAILURE
    And stock_reserved diminui em 2
    And stock_on_hand não diminui


  @fr-13 @ac-17
  Scenario: Health indica prontidão
    Given o banco aceita consultas
    When o cliente consulta GET /api/health
    Then a API responde 200

  @fr-13 @ac-17
  Scenario: Health indica indisponibilidade do banco
    Given o banco não aceita consultas
    When o cliente consulta GET /api/health
    Then a API responde 503

  @fr-1 @fr-2 @fr-10 @ac-21
  Scenario: Selecionar produto e quantidade no browser
    Given a página carregou produtos de GET /api/products
    When o usuário seleciona um produto, informa quantidade 2 e confirma
    Then POST /api/orders contém exatamente o productId selecionado e quantity 2
    And a tela começa a acompanhar o pedido retornado

  @fr-10 @ac-13
  Scenario: Bloquear múltiplos cliques durante processamento
    Given a tela exibe produto e quantidade válidos
    When o usuário inicia a compra
    Then a tela entra em loading
    And o botão permanece desabilitado durante submitting e tracking
    And apenas uma submissão lógica é iniciada

  @fr-10 @ac-14
  Scenario Outline: Exibir resultado compreensível
    Given a tentativa termina com <outcome>
    When a tela recebe o resultado
    Then a tela exibe uma mensagem específica para <message>

    Examples:
      | outcome                    | message                |
      | COMPLETED                  | sucesso                 |
      | VALIDATION_ERROR           | entrada inválida        |
      | INSUFFICIENT_STOCK         | estoque insuficiente    |
      | IDEMPOTENT_REPLAY          | tentativa já registrada |
      | TEMPORARY_ERP_FAILURE      | falha temporária        |

  @fr-9 @fr-10 @ac-15
  Scenario Outline: Reutilizar chave após resultado potencialmente desconhecido
    Given a submissão possui uma chave de idempotência
    And o resultado observado foi <outcome>
    When a tela repete a submissão
    Then a mesma chave e o mesmo request são enviados
    And a tela acompanha o pedido retornado quando ele já existe

    Examples:
      | outcome              |
      | resposta HTTP perdida |
      | 500 INTERNAL_ERROR    |

  @fr-9 @fr-10 @ac-15
  Scenario Outline: Gerar nova chave após resposta explícita sem pedido
    Given a API respondeu <code> e não criou pedido
    When o usuário corrige ou repete deliberadamente a submissão
    Then uma nova chave de idempotência é gerada

    Examples:
      | code                   |
      | VALIDATION_ERROR       |
      | PRODUCT_NOT_FOUND      |
      | INSUFFICIENT_STOCK     |
      | IDEMPOTENCY_KEY_REUSED |

  @fr-9 @fr-10 @ac-15 @ac-16
  Scenario: Criar nova tentativa após falha terminal
    Given um pedido terminou FAILED e sua reserva foi liberada
    When o usuário escolhe Retry
    Then produto e quantidade permanecem selecionados
    And uma nova chave de idempotência é gerada
    And um novo pedido é solicitado sujeito ao estoque atual

  @fr-7 @fr-9 @fr-10 @ac-22
  Scenario: Pausar e retomar consulta sem criar novo pedido
    Given a tela acompanha um pedido não terminal
    When o timeout de polling é atingido
    Then a tela entra em tracking_paused
    And mantém order ID e chave de idempotência
    And não permite um novo POST /api/orders
    When o usuário escolhe Consultar novamente
    Then a tela retoma GET /api/orders/{id}
    And acompanha o mesmo pedido até estado terminal

  @fr-10 @ac-16
  Scenario: Atualizar tela após sucesso
    Given a tela acompanha um pedido
    When o pedido se torna COMPLETED
    Then a mensagem de sucesso é exibida
    And a disponibilidade dos produtos é atualizada
    And a quantidade volta para 1

  @fr-10 @ac-16
  Scenario: Preservar tela após erro recuperável
    Given a tela possui produto e quantidade selecionados
    When ocorre validação, estoque insuficiente ou falha temporária
    Then produto e quantidade permanecem editáveis
    And o usuário pode corrigir ou tentar novamente conforme o erro

  @nfr-4 @ac-18
  Scenario: Correlacionar transições por logs estruturados
    Given um pedido percorre seus estados
    When os logs são coletados
    Then cada transição possui JSON válido
    And os eventos possuem correlationId e orderId quando aplicável
    And nenhum log contém secret ou payload completo

  @fr-11 @nfr-5 @ac-19
  Scenario: Executar script determinístico de falha e sucesso
    Given uma nova instância usa ERP_SIMULATION_MODE scripted
    And ERP_SIMULATION_SCRIPT é failure,success
    And o worker possui concorrência 1
    When o worker processa o primeiro pedido
    Then o primeiro pedido termina FAILED com TEMPORARY_ERP_FAILURE
    When o worker processa o segundo pedido
    Then o segundo pedido termina COMPLETED

  @nfr-9 @ac-20
  Scenario: Documentar execução e decisões
    Given o projeto está pronto para revisão
    When um avaliador abre README.md e PROMPTS.md
    Then encontra setup, comandos, decisões, limitações e próximos passos
    And encontra os comandos de verificação
    And encontra os prompts relevantes usados no trabalho
