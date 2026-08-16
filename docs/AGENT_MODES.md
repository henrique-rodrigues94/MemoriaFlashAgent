# Modos do MemoriaFlash Content Agent

O Agent não deve gerar cards por rotina sem necessidade. O modo `automatic` é conservador e prioriza correção de cards e pedidos reais de usuários.

## 1. correction

Processa somente feedbacks negativos que indiquem problema de conteúdo: resposta errada, explicação ruim, pergunta confusa, conteúdo desatualizado ou outro erro.

Fluxo:

`feedback → localizar card → analisar evidência → gerar substituto → substituir o mesmo card → registrar histórico`

O card original não é simplesmente apagado: a substituição fica registrada em `cardCorrectionHistory`.

## 2. update_requested

Processa somente matérias/assuntos que algum usuário colocou em `contentRequests`.

Fluxo:

`pedido → verificar grade existente → completar matéria/níveis → encontrar tópicos/subtópicos faltantes → gerar somente o shortfall → marcar pedido como completo`

Se a grade já estiver completa, ela é reutilizada e nenhuma chamada de IA é feita para recriá-la.

## 3. discover_new

Descobre novos assuntos relevantes antes de gerar cards.

Fluxo:

`candidatos → validar confiança → verificar se já existe → identificar nível → criar grade → encontrar folhas faltantes → gerar cards`

A descoberta é desabilitada por padrão (`CONTENT_AGENT_DISCOVERY_ENABLED=false`) para impedir crescimento automático do banco sem controle.

> A descoberta atual usa um curador de IA. Para pesquisa web verificável, pode-se adicionar depois um provedor de busca externo sem alterar os demais modos.

## 4. cleanup

Controla o tamanho do Firestore sem apagar conteúdo importante.

Critérios:

- só considera buckets antigos;
- preserva uma quantidade mínima de cards por bucket;
- combina uso, acerto, feedback positivo, qualidade, relevância e recência;
- registra o que seria removido;
- funciona em `dry-run` por padrão;
- só apaga quando `CONTENT_AGENT_CLEANUP_APPLY=true`.

Uso real deve ser registrado pelo app na coleção `cardUsage` com pelo menos `cardId`, `reviewCount`, `correctCount`, `incorrectCount`, `lastUsedAt` e/ou `lastReviewedAt`.

## 5. automatic

Fluxo seguro padrão:

1. `correction`
2. `update_requested`
3. descoberta somente se explicitamente habilitada
4. limpeza somente se explicitamente habilitada

Assim, um ciclo semanal normal não sai criando cards para matérias que ninguém pediu.

## Execução manual

O workflow `.github/workflows/content-agent.yml` possui `workflow_dispatch` e permite selecionar o modo. Use `cleanup` primeiro em dry-run; somente depois de conferir os logs habilite a exclusão real.
