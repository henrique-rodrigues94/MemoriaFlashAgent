# MemoriaFlashAgent — Checklist de melhorias

## Pipeline e confiabilidade
- [x] Estados: pending, processing, extracting, analyzing, generating, validating, publishing, completed, failed.
- [x] Retry limitado por `CONTENT_AGENT_MAX_RETRIES`.
- [x] Recuperação de jobs travados por timeout.
- [x] Registro de `attempts`, `lastError`, `lastErrorAt`, `nextRetryAt` e `recoveredAt`.
- [x] Limites de runtime, chamadas de IA, cards e requests por execução.
- [x] Deduplicação de documentos por SHA-256.

## Documentos
- [x] PDF/TXT.
- [x] Chunks persistidos no Firestore.
- [x] Fonte reutilizada pelo pipeline curricular e de cards.
- [x] Hash da fonte propagado até os cards.
- [x] Conteúdo vazio/assunto inválido gera falha controlada.

## Qualidade dos cards
- [x] Quality Gate independente.
- [x] Score de precisão, relevância, grounding e duplicidade.
- [x] Rejeição de perguntas/respostas inválidas.
- [x] Rejeição de cards com baixa evidência textual em documentos.
- [x] Deduplicação semântica básica no bucket.
- [x] Registro de qualidade no card/bucket.
- [x] Contagem de cards aprovados/rejeitados no progresso.
- [x] Testes unitários do Quality Gate.

## Proveniência e versionamento
- [x] `sourceHash` no card de documento.
- [x] `sourceSection` baseado no tópico processado.
- [x] `agentVersion`.
- [x] `promptVersion`.
- [x] Modelo/provider utilizado.
- [x] Versionamento de currículo e buckets.

## Conteúdo
- [x] Matéria/assunto.
- [x] Grade curricular.
- [x] Tópicos.
- [x] Subtópicos.
- [x] Tipos de card: definition, quiz, gap, comparison, applied, review.
- [x] Reaproveitamento de cards existentes.
- [x] Adaptação de dificuldade baseada em feedback.
- [ ] Deduplicação semântica global entre buckets diferentes — próxima evolução, requer índice/embeddings para escala.
- [ ] Detecção robusta de conteúdo atualizado entre documentos semanticamente semelhantes.

## Feedback
- [x] Feedback armazenado no Firestore.
- [x] Análise/adaptação existente.
- [x] Ajuste de dificuldade por feedback.
- [ ] Regeração automática de um card individual rejeitado com nova validação.

## Economia de IA
- [x] Cache existente.
- [x] Fallback entre providers.
- [x] Limite de chamadas por execução.
- [x] Reaproveitamento de cards do banco.
- [x] Deduplicação antes de nova geração.
- [x] Métricas de chamadas, cache e custo estimado.

## Observabilidade
- [x] `agentRuns`.
- [x] Logs detalhados de matéria, grade, tópicos, cards e falhas.
- [x] Métricas diárias.
- [x] Progresso persistido por request.
- [x] Quality score persistido.
- [ ] Dashboard administrativo visual.

## Segurança e Firestore
- [x] Firebase Admin somente no backend.
- [x] Regras de `contentRequests`/`sourceChunks`.
- [x] Validação de MIME/tamanho no fluxo do aplicativo.
- [x] Hash da fonte.
- [x] Separação entre usuário e processamento administrativo.
- [ ] Auditoria final das regras no projeto Firebase de produção.

## CI/CD
- [x] TypeScript.
- [x] Testes.
- [x] Build.
- [x] Testes do Quality Gate.
- [ ] Teste de integração real com Firebase em ambiente isolado.
- [ ] Teste end-to-end PDF/TXT → Agent → Firestore com credenciais de produção.

## Próxima evolução de escala
- [ ] Índice semântico/embeddings para deduplicação global.
- [ ] Extração estrutural por página/seção para PDFs complexos.
- [ ] Judge com segundo modelo apenas para cards de baixa confiança.
- [ ] Regeneração automática de cards rejeitados.
- [ ] Dashboard administrativo.
