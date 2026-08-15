# MemoriaFlashAgent.tar.gz — o que fazer

Este arquivo já contém o repositório inteiro pronto: `git init` feito,
os 2 commits (`first commit` com o README + o commit com todo o código do
agente), branch `main`, e o remote `origin` já apontando pro seu GitHub.
Só falta você dar o push com suas credenciais.

## Passo a passo

```bash
tar -xzf MemoriaFlashAgent.tar.gz
cd MemoriaFlashAgent

# confirme que está tudo certo
git log --oneline
# c6b3776 feat: FlashMind Content Agent — agente autônomo de manutenção do banco educacional
# 40aec5a first commit

git remote -v
# origin  https://github.com/henrique-rodrigues94/MemoriaFlashAgent.git

# crie o repositório vazio no GitHub antes (se ainda não existir):
gh repo create MemoriaFlashAgent --private --source=. --remote=origin --push
# ou, se já criou pelo site do GitHub, simplesmente:
git push -u origin main
```

## O que já testei antes de empacotar

- `npm install` limpo (zero dependência do repo `flashmind-ai`)
- `npm run typecheck` — só os 4 erros pré-existentes que já existiam no
  `flashmind-ai` original (não são deste trabalho, ver
  `docs/ARCHITECTURE.md`)
- `npm run build` — gera `dist/content-agent.cjs` (~85kb)
- `npx vitest run` — 40 testes, todos passando

## Depois do push

1. Configure os secrets em **Settings → Secrets and variables → Actions**:
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`,
   `GEMINI_API_KEY` (mesmos valores do `.env` do app `flashmind-ai`).
2. O workflow `.github/workflows/content-agent.yml` já está agendado para
   todo domingo 03:00 `America/Campo_Grande`. Pode rodar manual pela aba
   **Actions** → **content-agent** → **Run workflow** a qualquer momento.
3. Leia `README.md` e `docs/DEPLOYMENT.md` no próprio repo para as
   alternativas (Cloud Run Jobs) e detalhes de arquitetura.

## Por que não dei `git push` eu mesmo

Não tenho as credenciais da sua conta do GitHub — o comando falha aqui
sandbox com "could not read Username for 'https://github.com'", que é o
esperado. Tudo antes disso (init, commits, branch, remote) já está feito
dentro do tarball.
