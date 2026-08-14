# MemoriaFlashAgent

Agente autônomo de manutenção do banco de conteúdo educacional do
**FlashMind** (currículo, flashcards, aprendizado por feedback de
usuários). Serviço separado do app FlashMind — não roda no mesmo processo,
não compartilha deploy, só compartilha o mesmo projeto Firestore.

## O que ele faz

Ciclo completo, executado por agendamento (não por requisição HTTP):

```
RECEBER FEEDBACK → ANALISAR → APRENDER → REVISAR → DESCOBRIR → ORGANIZAR
  → GERAR → VALIDAR → PUBLICAR → REGISTRAR
```

- **Descobre** lacunas de conteúdo (matérias/níveis/tópicos sem cards
  suficientes) e gera flashcards em lotes controlados via IA (Gemini, com
  fallback para DeepSeek/OpenAI).
- **Aprende** com o feedback dos usuários do app (👍/👎 + motivo): ajusta
  dificuldade e a distribuição entre tipos de card, sempre de forma
  gradual e só com evidência estatística suficiente.
- **Revisa** e remove cards individuais de baixa qualidade quando o
  feedback aponta um problema específico, mantendo histórico para permitir
  rollback manual.
- **Controla custo**: limites configuráveis de tempo de execução, chamadas
  de IA e cards gerados por execução.

Ver `docs/ARCHITECTURE.md` para o detalhamento de cada módulo.

## Requisitos

- Node.js 20+
- Um projeto Firebase com Firestore (o mesmo usado pelo app FlashMind) e
  uma service account com permissão de Admin SDK
- Uma chave de API do Gemini (`GEMINI_API_KEY`) — DeepSeek/OpenAI são
  fallback opcional

## Uso local

```bash
npm install
cp env.example .env   # preencha as credenciais
npm run dev            # roda uma execução via tsx, sem build prévio
```

## Build e deploy

```bash
npm run build           # gera dist/content-agent.cjs (bundle standalone, ~85kb)
node dist/content-agent.cjs
```

Deploy recomendado: GitHub Actions agendado
(`.github/workflows/content-agent.yml`, já incluso — configure os secrets
em Settings → Secrets and variables → Actions) ou Cloud Run Jobs +
Cloud Scheduler via o `Dockerfile` incluso. Ver `docs/DEPLOYMENT.md`.

## Reverter uma revisão automática

```bash
npm run rollback -- "Português" "Regência" medio definition
```

## Testes

```bash
npm test          # roda uma vez
npm run test:watch
npm run typecheck
```

40 testes cobrindo planner, feedback analyzer, learning engine, card
updater e dashboard queries.

## Dados compartilhados com o app FlashMind

Este repositório não contém o app FlashMind nem seu frontend — só o
agente. As coleções do Firestore que ele usa:

- `subjects`, `curricula`, `cardBuckets` — lidas/escritas também pelo app
  (o agente reaproveita a mesma lógica de geração/validação/dedup)
- `cardFeedback` — escrita pelo app (cliente), lida só pelo agente
- `agentRuns`, `contentAdaptations`, `cardRevisionHistory` — exclusivas do
  agente

As regras de segurança do Firestore (`firestore.rules`) e o dashboard
administrativo (`/admin/content-agent.html`) ficam no repositório do app
FlashMind, não aqui — este repo só executa a lógica de manutenção.
