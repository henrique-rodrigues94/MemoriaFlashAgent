# MemoriaFlashAgent — checklist de produção

## Conteúdo

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

## Operação

- [x] Typecheck
- [x] Testes
- [x] Build
- [x] Limite de runtime
- [x] Limite de chamadas de IA
- [x] Limite de cards por execução
- [x] Métricas e logs
- [x] Fallback de provedores
- [x] Estratégia de cache

## Variáveis novas

`CONTENT_AGENT_REQUEST_TIMEOUT_MIN` define quanto tempo um request pode permanecer em `processing` antes de ser recuperado. O padrão é `120` minutos.

`CONTENT_AGENT_MAX_RETRIES` define o número máximo de tentativas por request. O padrão é `2`.

## Homologação obrigatória

1. Enviar um PDF pequeno.
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
