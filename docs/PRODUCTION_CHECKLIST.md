# MemoriaFlashAgent — checklist de produção

## 1. Conteúdo e arquitetura

- [x] Matéria/assunto
- [x] Grade curricular
- [x] Tópicos e subtópicos
- [x] Geração de flashcards
- [x] Validação/deduplicação
- [x] Publicação no Firestore
- [x] PDF/TXT via `contentRequests`
- [x] `sourceChunks`
- [x] SHA-256 e deduplicação no app
- [x] Deduplicação no Agent
- [x] Recuperação de requests presos em `processing`
- [x] Retry limitado por `CONTENT_AGENT_MAX_RETRIES`
- [x] Falha definitiva após exceder tentativas
- [x] Correção individual por feedback
- [x] Feedback marcado como `processed` após substituição bem-sucedida
- [x] Descoberta controlada de novos conteúdos
- [x] Atualização apenas de conteúdo solicitado/lacunas
- [x] Limpeza com dry-run e proteção de cards relevantes

## 2. Admin Agent

- [x] Dashboard administrativo local
- [x] Auditoria completa das coleções relevantes
- [x] Matérias/assuntos encontrados
- [x] Níveis encontrados
- [x] Grades
- [x] Tópicos
- [x] Subtópicos
- [x] Cards e buckets
- [x] Lacunas curriculares detectáveis quando existe currículo de referência
- [x] Feedback dos usuários
- [x] Solicitações de conteúdo
- [x] Métricas do Agent
- [x] Estimativa de utilização do Firestore
- [x] Token administrativo
- [x] Workflow manual `admin-audit.yml`
- [x] Relatório JSON como artifact
- [ ] Executar a primeira auditoria real no projeto de produção
- [ ] Revisar o primeiro relatório e confirmar os limites de armazenamento
- [ ] Não expor o dashboard publicamente sem uma camada de autenticação adicional

## 3. Segurança

- [ ] `FIREBASE_PROJECT_ID` configurado somente em Secrets/host
- [ ] `FIREBASE_CLIENT_EMAIL` configurado somente em Secrets/host
- [ ] `FIREBASE_PRIVATE_KEY` configurado somente em Secrets/host
- [ ] `ADMIN_DASHBOARD_TOKEN` forte, aleatório e fora do Git
- [ ] Service Account com menor privilégio possível
- [ ] Regras do Firestore revisadas no projeto de produção
- [ ] Índices necessários publicados
- [ ] Backup/exportação do Firestore configurado
- [ ] Logs sem chaves de API
- [ ] Dados pessoais minimizados nos logs

## 4. IA e custos

- [x] Gemini com limite por execução
- [x] DeepSeek com limite por execução/chamada
- [x] OpenAI com limite configurável
- [x] Métricas de custo
- [x] Fallback de provedores
- [x] Cache quando suportado
- [x] Limite de runtime
- [x] Limite de chamadas
- [x] Limite de cards
- [ ] Definir orçamento mensal final em USD
- [ ] Definir limites finais por execução
- [ ] Validar prompts com amostra real
- [ ] Conferir preços configurados antes de produção

## 5. Variáveis importantes

`CONTENT_AGENT_REQUEST_TIMEOUT_MIN` define quanto tempo um request pode permanecer em `processing` antes de ser recuperado. O padrão é `120` minutos.

`CONTENT_AGENT_MAX_RETRIES` define o número máximo de tentativas por request. O padrão é `2`.

`CONTENT_AGENT_DISCOVERY_ENABLED` deve permanecer `false` até a primeira validação de produção.

`CONTENT_AGENT_CLEANUP_ENABLED` deve permanecer `false` até a revisão do dry-run.

`CONTENT_AGENT_CLEANUP_APPLY` deve permanecer `false` até a aprovação explícita dos candidatos.

`FIRESTORE_FREE_STORAGE_BYTES` é a referência usada pelo dashboard para estimar o percentual do banco. A estimativa lógica não substitui a métrica oficial do Google Cloud/Firebase.

## 6. Homologação do Agent

1. Enviar um PDF pequeno pelo MemoriaFlash Mobile.
2. Confirmar `contentRequests/{id}`.
3. Confirmar `sourceChunks`.
4. Executar o Agent.
5. Confirmar `status=completed`.
6. Confirmar matéria, currículo, tópicos/subtópicos e cards.
7. Enviar o mesmo documento novamente e confirmar reutilização pelo SHA-256.
8. Forçar/aguardar um request `processing` antigo e confirmar recuperação.
9. Testar PDF sem texto.
10. Testar TXT grande.
11. Validar regras do Firestore em ambiente de produção.

## 7. Homologação do feedback

1. Abrir um card no Mobile.
2. Tocar em `Problema no card?`.
3. Selecionar `Resposta errada`.
4. Enviar comentário.
5. Confirmar documento em `cardFeedback` com `status=pending`.
6. Executar `Correção de cards` no Agent.
7. Confirmar substituição do card.
8. Confirmar `status=processed`.
9. Executar novamente e confirmar que o mesmo feedback não é processado novamente.

## 8. Homologação do Admin Agent

1. Configurar `.env` conforme `.env.example`.
2. Executar `npm run typecheck`.
3. Executar `npm test`.
4. Executar `npm run build:admin`.
5. Executar `npm run dev:admin`.
6. Abrir `http://127.0.0.1:8787`.
7. Informar `ADMIN_DASHBOARD_TOKEN` quando configurado.
8. Executar `Fazer varredura completa`.
9. Conferir matérias, níveis, tópicos, subtópicos, cards e feedbacks.
10. Conferir percentual estimado do Firestore.
11. Executar o workflow `admin-audit` no GitHub Actions.
12. Baixar e revisar o artifact `memoriaflash-admin-audit`.

## 9. Operação segura

Antes de habilitar qualquer ação destrutiva:

```text
AUDITORIA
   ↓
DRY-RUN
   ↓
REVISÃO ADMINISTRATIVA
   ↓
APROVAÇÃO
   ↓
EXECUÇÃO LIMITADA
   ↓
AUDITORIA NOVAMENTE
```

O Agent nunca deve gerar cards apenas para aumentar a quantidade do banco.
Toda geração precisa ter uma necessidade identificada:

1. correção solicitada por feedback;
2. conteúdo solicitado por usuário;
3. lacuna curricular confirmada;
4. descoberta explicitamente autorizada;
5. substituição de conteúdo removido por baixa qualidade.

A limpeza deve preservar cobertura curricular e os cards com maior utilização/relevância.
