# Deployment

## Opção A — GitHub Actions (recomendado)

O workflow já está em `.github/workflows/content-agent.yml`, agendado
para todo domingo às 03:00 `America/Campo_Grande`.

1. Vá em **Settings → Secrets and variables → Actions** neste repositório.
2. Configure os secrets obrigatórios: `FIREBASE_PROJECT_ID`,
   `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `GEMINI_API_KEY`.
3. (Opcional) `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` como fallback, e
   qualquer `CONTENT_AGENT_*` de `env.example` para sobrepor os defaults.
4. Pronto. Para rodar fora da agenda: aba **Actions** →
   **content-agent** → **Run workflow**.

## Opção B — Cloud Run Jobs + Cloud Scheduler

```bash
gcloud builds submit --tag gcr.io/SEU_PROJETO/memoriaflash-agent .

gcloud run jobs create memoriaflash-agent \
  --image gcr.io/SEU_PROJETO/memoriaflash-agent \
  --region southamerica-east1 \
  --set-env-vars CONTENT_AGENT_TIMEZONE=America/Campo_Grande \
  --set-secrets FIREBASE_PROJECT_ID=firebase-project-id:latest,FIREBASE_CLIENT_EMAIL=firebase-client-email:latest,FIREBASE_PRIVATE_KEY=firebase-private-key:latest,GEMINI_API_KEY=gemini-api-key:latest \
  --max-retries 1 \
  --task-timeout 1800s

gcloud scheduler jobs create http memoriaflash-agent-weekly \
  --location southamerica-east1 \
  --schedule "0 3 * * 0" \
  --time-zone "America/Campo_Grande" \
  --uri "https://REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/SEU_PROJETO/jobs/memoriaflash-agent:run" \
  --http-method POST \
  --oauth-service-account-email SUA_SERVICE_ACCOUNT@SEU_PROJETO.iam.gserviceaccount.com
```

Rodar manualmente: `gcloud run jobs execute memoriaflash-agent --region southamerica-east1`

## Firestore: regras e índices

Este repositório **não** gerencia `firestore.rules`/`firestore.indexes.json`
— eles ficam no repositório do app FlashMind, que já cobre as coleções
que o agente usa (`agentRuns`, `contentAdaptations`,
`cardRevisionHistory`, `cardFeedback`). Rode `firebase deploy --only firestore:rules,firestore:indexes`
a partir do repo do app quando essas regras mudarem.
