Desafio Técnico CaseCellShop — Nível Pleno | Fullstack
Parte 1.B — Mini-projeto de Código
Orientação: suba o código em um repositório público pessoal no GitHub e cole o link no final da sua resposta.

Contexto do case
Empresa fictícia. Caso usado exclusivamente para fins de avaliação técnica.

Você foi contratado(a) como Desenvolvedor(a) na CaseCellShop, uma empresa varejista focada na venda de capinhas para celular. A empresa está passando por hipercrescimento: o que antes eram milhares de acessos diários na loja virtual, hoje se transformaram em milhões.

Arquitetura atual
Componente Descrição
ERP Central monolito que gerencia estoque, faturamento, financeiro e contábil. É o coração da empresa.
Loja Virtual e-commerce que consome produtos, preços e estoque diretamente do ERP via API REST síncrona.
Banco de Dados ERP utiliza MySQL. Temos acesso de leitura, mas não podemos alterar rotinas, tabelas ou código interno do ERP.
Infraestrutura tudo hospedado em datacenter próprio, com intenção de evoluir para serviços mais escaláveis.
Monitoramento há alertas básicos de performance, mas pouca =rastreabilidade por pedido ou por requisição.
Os 3 problemas identificados
01 | Performance da vitrine — A vitrine demora muitos segundos para carregar produtos, frustrando clientes logo no início da jornada.

02 | Consistência de estoque — Vários clientes conseguem comprar o mesmo produto quando o estoque acaba. A empresa está vendendo itens que não possui.

03 | Resiliência do checkout — Ao finalizar a compra, a API do ERP demora para processar o pedido e gerar faturamento. A requisição sofre timeout e o cliente perde a compra.

Objetivo de evolução
A CaseCellShop quer reduzir a dependência direta do ERP nas jornadas críticas da loja, melhorar a experiência do cliente e evitar venda sem estoque. A solução deve ser incremental: pense no que pode ser construído primeiro, com risco controlado, sem reescrever todo o ERP.

Escopo da mini-tarefa
Implemente um pequeno fluxo fullstack de checkout para compra de capinhas de celular.

A aplicação deve permitir que um usuário visualize produtos, escolha uma quantidade e tente finalizar uma compra. O sistema deve lidar com sucesso, erro de validação, estoque insuficiente, tentativa duplicada e falha temporária de processamento.

Você pode usar dados em memória ou banco local. Não é necessário usar autenticação, pagamento real, deploy, cloud real ou layout elaborado.

O que esperamos observar na entrega
Back-end
Existe uma API para listar ou consultar produtos.
Existe uma API para criar uma tentativa de compra.
A API valida entradas inválidas.
A API diferencia sucesso, erro de validação, estoque insuficiente e falha técnica.
A solução evita vender mais unidades do que o estoque disponível.
Há alguma estratégia simples contra pedido duplicado?
Há uma simulação clara de processamento lento ou instável do ERP.
Front-end
Existe uma tela simples para listar produtos ou selecionar um produto.
O usuário consegue informar quantidade e iniciar a compra.
A interface mostra loading e evita múltiplos cliques durante o processamento.
A interface exibe mensagens compreensíveis para sucesso, estoque insuficiente, entrada inválida e falha temporária.
O estado da tela permanece coerente após erro ou retry.
Qualidade e entrega
O projeto possui README explicando como instalar e rodar.
O README explica decisões técnicas, limitações e próximos passos.
A escolha de stack é explicada quando diferente da preferencial.
Há testes automatizados ou uma estratégia clara de verificação.
O código está organizado de forma compreensível.
Bônus: incluir diagrama simples, logs estruturados, endpoint de status do pedido ou teste de concorrência.

PROMPTS.md
registra os prompts relevantes, quando aplicável.
Limites do escopo
Não esperamos:

pagamento real;
autenticação completa;
integração real com ERP;
uso obrigatório de Docker;
deploy em cloud;
mensageria real em produção;
layout sofisticado.
Como entregar
Respostas das 6 perguntas conceituais (Parte 1.A).
Link do repositório GitHub público (Parte 1.B).
README com instruções de execução e decisões técnicas.

PROMPTS.md, quando aplicável.
