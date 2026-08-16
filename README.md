# MemoriaFlashAgent

Agente autônomo de manutenção do banco de conteúdo educacional do MemoriaFlash. É um serviço separado do app Mobile: o aplicativo continua gerando e estudando cards mesmo quando o Agent estiver desligado.

## Objetivo

O Agent mantém, corrige, completa, descobre e limpa o banco de conteúdo de forma controlada. A regra principal é: **se não existe uma necessidade identificada, o Agent não deve gerar novos cards.**

## Modos

| GitHub Actions | Interno | Função |
|---|---|---|
| Automático | `automatic` | Manutenção normal sem descoberta espontânea |
| Correção de cards | `correction` | Corrige cards com feedback negativo |
| Atualizar conteúdos solicitados | `update_requested` | Completa somente lacunas de conteúdos solicitados |
| Buscar novos conteúdos | `discover_new` | Pesquisa e adiciona conteúdo somente quando autorizado |
| Limpeza de cards | `cleanup` | Reduz conteúdo pouco relevante com dry-run obrigatório |

## Mobile independente do Agent

```text
MemoriaFlash Mobile
      │
      ├── Geração de cards com IA ────────────────► funciona sem Agent
      │
      └── Feedback do usuário ──► Firestore/cardFeedback
                                      │
                                      ▼
                              MemoriaFlashAgent
                                      │
                         correção/curadoria assíncrona
```

O Agent é complementar. Não existe dependência síncrona do Mobile com o Agent para gerar ou estudar cards.

## Admin Agent

Existe um dashboard administrativo separado para o proprietário do sistema. Ele consulta o Firestore pelo Firebase Admin SDK e mostra:

- matérias/assuntos;
- níveis;
- cobertura curricular;
- tópicos e subtópicos;
- quantidade de cards e buckets;
- lacunas detectáveis quando existe currículo de referência;
- feedback dos usuários e motivos;
- solicitações de conteúdo;
- coleções e tamanho lógico estimado;
- percentual de uso em relação à referência configurada;
- última auditoria.

### Executar localmente

```bash
npm install
npm run typecheck
npm test
npm run build:admin
npm run dev:admin
```

Abra:

```text
http://127.0.0.1:8787
```

Configure antes:

```env
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
ADMIN_DASHBOARD_HOST=127.0.0.1
ADMIN_DASHBOARD_PORT=8787
ADMIN_DASHBOARD_TOKEN=um-token-longo-e-aleatorio
FIRESTORE_FREE_STORAGE_BYTES=1073741824
```

Nunca publique o token ou a chave privada do Firebase no Git.

### Auditoria pelo terminal

```bash
npm run admin:audit
```

### Auditoria pelo GitHub Actions

Use:

```text
Actions → admin-audit → Run workflow
```

O workflow executa typecheck, testes e auditoria do Firestore e salva o relatório JSON como artifact por 14 dias.

## Content Agent pelo GitHub Actions

Workflow:

```text
.github/workflows/content-agent.yml
```

Use:

```text
Actions → content-agent → Run workflow
```

### Correção

```text
Modo: Correção de cards
Descoberta: desmarcada
```

### Atualização solicitada

```text
Modo: Atualizar conteúdos solicitados
Descoberta: desmarcada
```

### Descoberta

```text
Modo: Buscar novos conteúdos
Descoberta: marcada
```

### Limpeza

Primeiro faça dry-run:

```text
Modo: Limpeza de cards
Apagar candidatos: desmarcado
```

Somente depois da revisão do relatório autorize a exclusão.

## Primeira homologação recomendada

1. Gerar um card pelo Mobile com o Agent desligado.
2. Estudar normalmente.
3. Enviar `Problema no card?`.
4. Confirmar `cardFeedback.status=pending`.
5. Executar `Correção de cards`.
6. Confirmar substituição do card.
7. Confirmar `cardFeedback.status=processed`.
8. Executar `admin-audit`.
9. Conferir matéria, nível, tópicos, subtópicos, cards e armazenamento.
10. Testar uma solicitação PDF/TXT.
11. Executar `Atualizar conteúdos solicitados`.
12. Confirmar que conteúdo existente não foi duplicado.
13. Testar descoberta somente em modo manual/autorizado.
14. Executar limpeza somente em dry-run.

## Produção

Consulte `docs/PRODUCTION_CHECKLIST.md` antes de habilitar o Agent no projeto real.

Principais requisitos ainda dependentes do ambiente:

- credenciais reais do Firebase;
- secrets das APIs de IA;
- orçamento e limites finais;
- backup do Firestore;
- validação das regras e índices do projeto de produção;
- primeira auditoria real do banco.

## Arquivos importantes

```text
src/server/contentAgent/       Agent principal
src/server/adminAgent/         Dashboard administrativo
src/server/contentAgent/admin/ Auditoria do Firestore
.github/workflows/content-agent.yml
.github/workflows/admin-audit.yml
docs/PRODUCTION_CHECKLIST.md
.env.example
```
