# Arquitetura

```
src/server/
├── ai/                          # copiado do flashmind-ai — camada de IA reaproveitada
│   ├── AIOrchestrator.ts        # fallback automático entre provedores, retry, cooldown
│   ├── index.ts                 # instância única (aiOrchestrator) com Gemini/DeepSeek/OpenAI
│   ├── jsonUtils.ts             # parsing robusto de JSON retornado por LLMs
│   ├── types.ts
│   ├── providers/{gemini,deepseek,openai}.ts
│   └── tasks/
│       ├── generateFlashcards.ts    # banco→IA→validação→dedup→save (reaproveitado tal qual)
│       ├── generateCurriculum.ts
│       └── identifySubjectLevels.ts
├── db/
│   ├── db.ts                    # única camada de leitura/escrita no Firestore
│   └── firestoreSchema.ts       # schema de subjects/curricula/cardBuckets/cardFeedback
├── firebaseAdmin.ts              # inicialização lazy do Firebase Admin SDK
└── contentAgent/                 # o agente em si
    ├── config/agentConfig.ts     # limites, thresholds, matérias geridas — tudo via env var
    ├── agent/
    │   ├── planner.ts            # garante currículo, monta plano priorizado
    │   └── orchestrator.ts       # ciclo completo, ponto de entrada
    ├── curriculum/topicAnalyzer.ts
    ├── cards/
    │   ├── cardGenerator.ts      # geração em lotes, aplica dificuldade adaptada
    │   ├── cardBucketRepository.ts   # remoção de cards + histórico + rollback
    │   └── cardQualityReviewer.ts    # CardUpdater
    ├── feedback/
    │   ├── feedbackRepository.ts
    │   ├── feedbackAnalyzer.ts       # agregação por tópico/card/tipo
    │   ├── adaptationRepository.ts   # contentAdaptations
    │   └── learningEngine.ts         # ajuste gradual de dificuldade/distribuição
    ├── jobs/                     # wrappers finos chamados pelo orchestrator
    ├── monitoring/
    │   ├── runLogger.ts          # agentRuns
    │   └── dashboardQueries.ts   # usado pelo dashboard no repo do app
    ├── run.ts                    # entrypoint CLI/produção
    └── rollback.ts                # CLI de rollback manual
```

## Por que a pasta `ai/`/`db/` está duplicada aqui?

Esses arquivos são cópias dos equivalentes em `flashmind-ai` (o repo do
app). Duplicação deliberada: como este é um repositório de deploy
separado (sem histórico Git compartilhado com o app), copiar os módulos
necessários é mais simples e mais robusto do que depender de um pacote
npm privado ou submódulo Git. O preço é ter que sincronizar manualmente se
a lógica de geração/validação mudar no app — aceitável dado que essa
lógica é estável e muda pouco.

## Fluxo de uma execução

Ver `README.md` para o diagrama do ciclo. Em código, `orchestrator.ts`:

```ts
await analyzeFeedbackJob(tracker);      // ANALISAR + APRENDER
await reviewFlaggedTopicsJob(tracker);  // REVISAR (CardUpdater)
const plan = await discoverTopicsJob(tracker); // DESCOBRIR + ORGANIZAR
await generateCardsJob(plan, tracker);  // GERAR + VALIDAR + PUBLICAR
await persistRunSummary(tracker.toSummary('completed')); // REGISTRAR
```

Cada etapa respeita os limites de `agentConfig.limits`
(`maxRuntimeMinutes`, `maxAiCallsPerRun`, `maxCardsPerRun`,
`maxTopicsPerRun`) — a execução para graciosamente se algum limite for
atingido, sem perder o trabalho já persistido.
