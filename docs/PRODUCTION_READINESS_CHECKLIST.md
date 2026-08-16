# MemoriaFlashAgent — Checklist de prontidão para produção real

> **Objetivo:** levar o Content Agent de um estado de desenvolvimento/testes para um serviço que possa processar conteúdo real de usuários com segurança, previsibilidade, observabilidade, controle de custos e capacidade de recuperação.
>
> **Regra de release:** produção só é considerada **GO** quando todos os itens **P0 — bloqueadores de produção** estiverem concluídos e validados em ambiente isolado/staging. Itens P1 podem ser aceitos somente com risco documentado e plano de correção.

## 0. Critério de GO/NO-GO

- [ ] **P0** Nenhum segredo, chave privada ou credencial está versionado.
- [ ] **P0** Ambiente de produção é separado de desenvolvimento/testes.
- [ ] **P0** Firebase/Firestore de produção foi auditado e as regras foram testadas com usuários reais simulados.
- [ ] **P0** O Agent possui execução idempotente e não processa o mesmo request simultaneamente em duas instâncias.
- [ ] **P0** Uploads/documentos são validados por tipo, tamanho, conteúdo e limites de processamento.
- [ ] **P0** Há limites de custo e de chamadas de IA por usuário/request/dia.
- [ ] **P0** Falhas de IA, Firebase, rede e parsing não deixam requests presos indefinidamente.
- [ ] **P0** Há logs, métricas, alertas e identificação de uma execução específica (`runId`/requestId).
- [ ] **P0** Backup e restauração do Firestore foram testados de verdade.
- [ ] **P0** Pipeline PDF/TXT → processamento → quality gate → publicação foi validado em staging com dados representativos.
- [ ] **P0** Rollback de aplicação/configuração/conteúdo foi testado.
- [ ] **P0** CI bloqueia merge/deploy quando typecheck, testes ou build falham.
- [ ] **P0** Não existem erros críticos conhecidos sem mitigação.

---

## 1. Arquitetura e execução do Agent

### Concorrência, idempotência e filas

- [ ] **P0** Implementar lock/lease transacional para `contentRequests` antes de mudar `pending → processing`.
- [ ] **P0** Garantir que duas instâncias nunca processem o mesmo request simultaneamente.
- [ ] **P0** Tornar cada etapa idempotente: repetir uma etapa não duplica currículo, bucket ou card.
- [ ] **P0** Criar `requestId`/`runId` consistente em todos os logs e documentos derivados.
- [ ] **P0** Persistir heartbeat durante processamento longo.
- [ ] **P0** Recuperar leases expirados sem apagar trabalho parcialmente concluído.
- [ ] **P1** Separar ingestão, processamento e publicação em jobs independentes quando a escala justificar.
- [ ] **P1** Definir limite máximo de concorrência global e por usuário.
- [ ] **P1** Implementar backoff exponencial com jitter para serviços externos.
- [ ] **P1** Implementar circuit breaker para provider de IA indisponível.

### Scheduler/worker

- [ ] **P0** Confirmar comportamento quando o scheduler dispara duas execuções próximas.
- [ ] **P0** Impedir execução duplicada do worker.
- [ ] **P0** Definir timeout absoluto do processo e timeout individual por chamada externa.
- [ ] **P0** Garantir encerramento gracioso (`SIGTERM`) sem perder estado.
- [ ] **P1** Implementar health check/readiness se o Agent rodar como serviço HTTP/container.

---

## 2. Firebase / Firestore — produção

### Projeto e ambientes

- [ ] **P0** Criar/confirmar projeto Firebase de produção separado do projeto de desenvolvimento.
- [ ] **P0** Configurar variáveis de ambiente exclusivamente no ambiente de execução.
- [ ] **P0** Nunca usar credenciais de desenvolvimento em produção.
- [ ] **P0** Confirmar região do Firestore e demais serviços compatível com os requisitos de latência e dados.
- [ ] **P0** Habilitar billing/limites apropriados e alertas de orçamento.

### Regras e autorização

- [ ] **P0** Auditar `firestore.rules` no projeto real, não apenas no repositório.
- [ ] **P0** Testar leitura/escrita por usuário autenticado.
- [ ] **P0** Testar acesso de usuário a documentos de outro usuário.
- [ ] **P0** Testar usuário anônimo/não autenticado.
- [ ] **P0** Garantir que coleções administrativas (`agentRuns`, métricas, adaptações, logs e similares) não sejam graváveis pelo cliente.
- [ ] **P0** Garantir que o cliente nunca consiga alterar campos de controle do Agent (`status`, `attempts`, `qualityScore`, `sourceHash`, `provider`, etc.).
- [ ] **P0** Validar regras com Emulator Suite e testes automatizados.
- [ ] **P0** Revisar índices e consultas que serão executadas em produção.
- [ ] **P1** Ativar monitoramento de crescimento de coleções e documentos.

### Integridade e operações

- [ ] **P0** Validar atomicidade das atualizações críticas.
- [ ] **P0** Evitar documentos próximos do limite de tamanho do Firestore.
- [ ] **P0** Definir estratégia para buckets que crescem indefinidamente.
- [ ] **P0** Definir retenção/expiração para chunks, logs e dados temporários.
- [ ] **P1** Criar rotina de limpeza segura para dados expirados.

---

## 3. Segurança de aplicação

### Segredos e identidade

- [ ] **P0** Nenhuma API key, service-account JSON ou private key no Git.
- [ ] **P0** Usar Secret Manager/secret store da infraestrutura de produção.
- [ ] **P0** Aplicar menor privilégio à identidade usada pelo Agent.
- [ ] **P0** Rotacionar credenciais antes do primeiro release caso tenham sido usadas fora de um secret manager.
- [ ] **P0** Separar credenciais de staging e produção.
- [ ] **P1** Criar procedimento documentado de rotação/revogação.

### Entrada de documentos

- [ ] **P0** Validar extensão e MIME real do arquivo.
- [ ] **P0** Limitar tamanho do upload.
- [ ] **P0** Limitar quantidade de páginas/linhas/tokens processados.
- [ ] **P0** Detectar arquivos corrompidos.
- [ ] **P0** Rejeitar tipos não suportados antes de chamar IA.
- [ ] **P0** Normalizar/limpar texto extraído para evitar payloads abusivos.
- [ ] **P0** Definir proteção contra prompt injection contido em documentos.
- [ ] **P0** Nunca tratar instruções encontradas no documento como instruções do sistema.
- [ ] **P1** Sanitizar conteúdo exibido em logs e evitar armazenar dados pessoais desnecessários.

### Abuse/rate limiting

- [ ] **P0** Limitar requests por usuário.
- [ ] **P0** Limitar uploads por usuário.
- [ ] **P0** Limitar tamanho total diário/mensal processado por usuário.
- [ ] **P0** Limitar custo de IA por request e usuário.
- [ ] **P0** Ter resposta controlada para excesso de limite (`429`/estado equivalente).
- [ ] **P1** Detectar padrões anormais de abuso.

---

## 4. Pipeline de documentos

- [ ] **P0** Testar PDF textual pequeno.
- [ ] **P0** Testar PDF grande.
- [ ] **P0** Testar PDF com várias páginas.
- [ ] **P0** Testar PDF escaneado/imagem e definir comportamento explícito caso OCR não esteja disponível.
- [ ] **P0** Testar TXT vazio.
- [ ] **P0** Testar TXT com caracteres Unicode/acentos.
- [ ] **P0** Testar arquivo corrompido.
- [ ] **P0** Testar documento com conteúdo duplicado.
- [ ] **P0** Testar o mesmo documento novamente e confirmar idempotência por hash.
- [ ] **P0** Confirmar que o `sourceHash` acompanha o documento até o card publicado.
- [ ] **P0** Confirmar rastreabilidade de card → documento → seção/tópico.
- [ ] **P1** Implementar extração estrutural por página/seção para PDFs complexos.
- [ ] **P1** Detectar documento atualizado semanticamente, mesmo quando o hash mudou.

---

## 5. Qualidade e segurança do conteúdo gerado

### Quality Gate

- [ ] **P0** Definir score mínimo oficial para publicação.
- [ ] **P0** Definir critérios mínimos de grounding por tipo de conteúdo.
- [ ] **P0** Rejeitar front vazio, back vazio ou campos inconsistentes.
- [ ] **P0** Rejeitar pergunta/resposta duplicada.
- [ ] **P0** Rejeitar explicação que apenas repete a resposta.
- [ ] **P0** Rejeitar conteúdo fora do tópico solicitado.
- [ ] **P0** Rejeitar conteúdo que contradiga a fonte quando o modo é baseado em documento.
- [ ] **P0** Registrar motivo da rejeição.
- [ ] **P0** Garantir que card rejeitado nunca seja publicado no bucket final.
- [ ] **P0** Regenerar card rejeitado com nova tentativa e nova validação.
- [ ] **P1** Usar segundo modelo/Judge somente para cards de baixa confiança ou alto impacto.

### Conteúdo educacional

- [ ] **P0** Validar nível educacional do card.
- [ ] **P0** Validar dificuldade real do card.
- [ ] **P0** Evitar afirmações sem evidência quando o documento é a fonte primária.
- [ ] **P0** Evitar datas, números, leis e citações inventadas.
- [ ] **P1** Criar conjunto dourado de cards revisados manualmente para benchmark de qualidade.
- [ ] **P1** Medir precisão por matéria, nível, provider e tipo de card.

---

## 6. IA / Providers / custos

- [ ] **P0** Definir provider principal de produção.
- [ ] **P0** Definir fallback oficial.
- [ ] **P0** Validar comportamento quando todos os providers falham.
- [ ] **P0** Definir timeout de cada chamada.
- [ ] **P0** Implementar retry somente para erros transitórios.
- [ ] **P0** Não repetir chamadas por erro de validação sem limite.
- [ ] **P0** Registrar tokens de entrada/saída quando disponíveis.
- [ ] **P0** Registrar provider/modelo usado.
- [ ] **P0** Criar teto diário/mensal de gasto estimado.
- [ ] **P0** Parar geração quando o orçamento configurado for atingido.
- [ ] **P1** Criar métricas de custo por matéria, usuário, request e tipo de card.
- [ ] **P1** Testar alteração de provider sem alterar o domínio do Agent.
- [ ] **P1** Criar benchmark de qualidade/custo para cada provider suportado.

---

## 7. Observabilidade e alertas

### Logs

- [ ] **P0** Logs estruturados em JSON em produção.
- [ ] **P0** Cada log possui timestamp, nível, `runId`, requestId e etapa.
- [ ] **P0** Não registrar secrets, tokens, documentos completos ou PII desnecessária.
- [ ] **P0** Registrar duração das chamadas externas.
- [ ] **P0** Registrar erro com categoria e causa original.

### Métricas

- [ ] **P0** Requests por status.
- [ ] **P0** Tempo médio/p95/p99 de processamento.
- [ ] **P0** Taxa de erro.
- [ ] **P0** Taxa de retry.
- [ ] **P0** Cards gerados/aprovados/rejeitados.
- [ ] **P0** Quality score médio.
- [ ] **P0** Chamadas de IA e custo estimado.
- [ ] **P0** Cache hit/miss.
- [ ] **P0** Fila pendente e idade do request mais antigo.

### Alertas

- [ ] **P0** Alertar quando requests ficam travados acima do SLA.
- [ ] **P0** Alertar aumento anormal de erros.
- [ ] **P0** Alertar provider de IA indisponível.
- [ ] **P0** Alertar aumento anormal de rejeição de cards.
- [ ] **P0** Alertar custo acima do limite.
- [ ] **P1** Criar dashboard administrativo visual.

---

## 8. Backup, recuperação e rollback

- [ ] **P0** Definir RPO e RTO do serviço.
- [ ] **P0** Configurar backup do Firestore conforme necessidade de produção.
- [ ] **P0** Testar restauração em projeto separado.
- [ ] **P0** Documentar recuperação após corrupção de conteúdo.
- [ ] **P0** Manter versionamento de Agent e prompt.
- [ ] **P0** Ter rollback da aplicação para a última versão estável.
- [ ] **P0** Ter rollback de alterações de schema/estrutura de dados.
- [ ] **P0** Nunca apagar conteúdo anterior durante uma atualização sem backup/versão.
- [ ] **P1** Criar procedimento de disaster recovery executável por outra pessoa.

---

## 9. Testes de produção

### Unitários

- [ ] **P0** Quality Gate.
- [ ] **P0** Deduplicação.
- [ ] **P0** Hash/proveniência.
- [ ] **P0** Retry/backoff.
- [ ] **P0** Estados do request.
- [ ] **P0** Limites de custo/runtime/cards/requests.
- [ ] **P0** Adaptação de dificuldade.

### Integração

- [ ] **P0** Firebase Emulator Suite.
- [ ] **P0** Firebase real em projeto de staging.
- [ ] **P0** Escrita/leitura das coleções do Agent.
- [ ] **P0** Falha/reconexão do Firestore.
- [ ] **P0** Falha/retry de provider.
- [ ] **P0** Documento duplicado.
- [ ] **P0** Documento atualizado.

### E2E

- [ ] **P0** PDF válido → request → curriculum → cards → quality gate → Firestore.
- [ ] **P0** TXT válido → request → cards.
- [ ] **P0** Documento inválido → erro controlado.
- [ ] **P0** Documento duplicado → não gerar conteúdo duplicado.
- [ ] **P0** Card rejeitado → regenerar → validar → publicar somente se aprovado.
- [ ] **P0** Worker interrompido → recuperação sem duplicação.
- [ ] **P0** Dois workers simultâneos → apenas um processa o request.
- [ ] **P1** Teste de carga com volume representativo.
- [ ] **P1** Teste de soak por várias horas.

---

## 10. CI/CD e supply chain

- [ ] **P0** `npm ci` obrigatório no CI.
- [ ] **P0** `typecheck` obrigatório.
- [ ] **P0** testes obrigatórios.
- [ ] **P0** build obrigatório.
- [ ] **P0** Lockfile versionado.
- [ ] **P0** Dependências vulneráveis críticas bloqueiam release.
- [ ] **P0** Imagem Docker reproduzível, caso Docker seja usado.
- [ ] **P0** Deploy somente de commit aprovado.
- [ ] **P0** Produção não pode receber código diretamente da máquina local.
- [ ] **P1** Dependabot/Renovate ou processo equivalente de atualização.
- [ ] **P1** Scan de secrets no CI.
- [ ] **P1** Scan de vulnerabilidades da imagem/container.
- [ ] **P1** Release com versão imutável/tag.

---

## 11. Docker / runtime

- [ ] **P0** Container roda como usuário não-root.
- [ ] **P0** Imagem mínima sem ferramentas desnecessárias.
- [ ] **P0** `.dockerignore` configurado.
- [ ] **P0** Nenhum `.env`/secret dentro da imagem.
- [ ] **P0** Health/readiness definidos quando aplicável.
- [ ] **P0** Limites de CPU/memória definidos.
- [ ] **P0** Graceful shutdown testado.
- [ ] **P1** Container reproduzível localmente e em staging.

---

## 12. Privacidade / LGPD

- [ ] **P0** Mapear quais dados pessoais chegam ao Agent.
- [ ] **P0** Definir finalidade do processamento.
- [ ] **P0** Minimizar dados pessoais enviados ao provider de IA.
- [ ] **P0** Definir retenção de documentos, chunks, logs e resultados.
- [ ] **P0** Definir procedimento de exclusão dos dados do usuário.
- [ ] **P0** Garantir que logs não armazenem conteúdo pessoal desnecessário.
- [ ] **P0** Documentar quais providers recebem conteúdo e para qual finalidade.
- [ ] **P1** Revisar termos, política de privacidade e base legal do produto com orientação jurídica quando necessário.

---

## 13. Segurança operacional

- [ ] **P0** Definir quem pode alterar variáveis de produção.
- [ ] **P0** Definir quem pode executar rollback.
- [ ] **P0** Definir quem recebe alertas.
- [ ] **P0** Criar runbook para falha do Agent.
- [ ] **P0** Criar runbook para provider de IA indisponível.
- [ ] **P0** Criar runbook para Firestore indisponível.
- [ ] **P0** Criar runbook para custo anormal.
- [ ] **P0** Criar runbook para conteúdo incorreto publicado.
- [ ] **P1** Fazer simulado de incidente antes do lançamento.

---

## 14. Performance e escala

- [ ] **P0** Medir tempo por documento, tópico e lote.
- [ ] **P0** Definir SLA de processamento.
- [ ] **P0** Confirmar que consultas possuem índices adequados.
- [ ] **P0** Evitar leitura repetitiva desnecessária do mesmo documento/bucket.
- [ ] **P0** Confirmar que documentos/buckets não crescem sem limite.
- [ ] **P1** Implementar processamento paralelo controlado por tópico.
- [ ] **P1** Índice semântico/embeddings para deduplicação global.
- [ ] **P1** Cache de contexto/chunks com invalidação correta.
- [ ] **P1** Teste de carga para determinar capacidade máxima segura.

---

## 15. Conteúdo e evolução contínua

- [ ] **P1** Criar benchmark fixo por matéria e nível.
- [ ] **P1** Comparar providers periodicamente.
- [ ] **P1** Monitorar feedback negativo por tópico.
- [ ] **P1** Revisar cards com alta taxa de rejeição/feedback negativo.
- [ ] **P1** Detectar regressão após mudança de prompt.
- [ ] **P1** Versionar prompts com possibilidade de rollback.
- [ ] **P1** Detectar mudança semântica entre documentos da mesma fonte.
- [ ] **P1** Criar política para arquivar conteúdo obsoleto.

---

# Ordem recomendada de execução

## Fase 1 — Bloqueadores críticos

- [ ] Concorrência/lock/idempotência.
- [ ] Firebase produção + regras.
- [ ] Secrets/identidade.
- [ ] Limites de abuso/custo.
- [ ] Upload/document security.
- [ ] Timeouts/retries/recovery.
- [ ] Backup/restore.

## Fase 2 — Qualidade e confiabilidade

- [ ] E2E em staging.
- [ ] Regeneração de rejeitados.
- [ ] Benchmark de qualidade.
- [ ] Observabilidade completa.
- [ ] Alertas.

## Fase 3 — Deploy real

- [ ] Docker/runtime.
- [ ] CI/CD protegido.
- [ ] Deploy staging.
- [ ] Smoke test.
- [ ] Deploy produção controlado.
- [ ] Smoke test pós-deploy.

## Fase 4 — Escala

- [ ] Dashboard.
- [ ] Embeddings/deduplicação global.
- [ ] Processamento paralelo.
- [ ] Teste de carga/soak.
- [ ] Otimização de custo.

# Definição final de pronto

O MemoriaFlashAgent só deve ser marcado como **PRODUÇÃO** quando:

1. Todos os itens **P0** estiverem marcados.
2. O pipeline E2E tiver passado em staging.
3. O restore do backup tiver sido comprovado.
4. O teste de concorrência tiver comprovado ausência de processamento duplicado.
5. Os limites de custo e abuso tiverem sido comprovados.
6. As regras reais do Firebase tiverem sido auditadas.
7. O rollback tiver sido testado.
8. Houver monitoramento e alertas ativos.
9. Não houver segredo versionado.
10. Houver um responsável e um runbook para incidentes.

**Status:** `NOT READY` até que os critérios acima sejam comprovados.
