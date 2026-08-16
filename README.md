# MemoriaFlashAgent

Agente autônomo de manutenção do banco de conteúdo educacional do
**FlashMind** (currículo, flashcards, aprendizado por feedback de
usuários). É um serviço separado do app FlashMind: não roda no mesmo
processo, não compartilha deploy e utiliza o mesmo projeto Firebase/Firestore.

## Objetivo

O MemoriaFlashAgent não deve ficar gerando flashcards sem necessidade.
Sua função é **manter, corrigir, completar, descobrir e limpar** o banco de
conteúdo de forma controlada, sempre priorizando conteúdo solicitado ou
necessário.

A regra principal é:

> **Se não existe uma necessidade identificada, o Agent não deve gerar novos cards.**

## Modos de funcionamento

O Agent possui cinco modos. No GitHub Actions, os nomes aparecem em
português; internamente eles são convertidos para os identificadores técnicos
usados pelo código.

| Opção no GitHub Actions | Modo interno | Função |
|---|---|---|
| **Automático** | `automatic` | Executa a manutenção normal sem iniciar descoberta de conteúdo por conta própria. |
| **Correção de cards** | `correction` | Corrige cards que receberam feedback negativo ou foram sinalizados como problemáticos. |
| **Atualizar conteúdos solicitados** | `update_requested` | Completa matérias/grades/tópicos/subtópicos que foram solicitados pelos usuários, criando apenas o que estiver faltando. |
| **Buscar novos conteúdos** | `discover_new` | Pesquisa oportunidades de novos conteúdos, avalia a relevância e só então cria matéria, grade, tópicos, subtópicos e cards necessários. |
| **Limpeza de cards** | `cleanup` | Identifica cards pouco relevantes ou sem uso para reduzir o tamanho do banco, preservando os mais importantes. |

---

## 1. Automático

O modo **Automático** é o modo padrão para a manutenção periódica.

Ele prioriza tarefas que já possuem uma necessidade clara:

```text
Feedback negativo
      ↓
Correção necessária

Pedido de usuário
      ↓
Conteúdo faltante

Sem necessidade identificada
      ↓
Não gerar cards
```

A descoberta de novos conteúdos permanece desativada por padrão.

Isso evita que uma execução semanal simplesmente invente matérias ou gere
milhares de cards que ninguém pediu.

---

## 2. Correção de cards

Use **Correção de cards** quando quiser tratar problemas encontrados pelos
usuários.

Fluxo:

```text
Feedback negativo
      ↓
Identificar o card correto
      ↓
Ler motivo/comentário do feedback
      ↓
Analisar o conteúdo atual
      ↓
Corrigir com IA
      ↓
Validar a correção
      ↓
Atualizar o card
      ↓
Registrar histórico
```

O Agent trabalha somente nos cards que precisam de correção. Ele não deve
regerar uma matéria inteira por causa de um erro em um único card.

O histórico de alterações permite auditoria e rollback manual quando
necessário.

---

## 3. Atualizar conteúdos solicitados

Esse é o modo usado para atender pedidos de matérias/conteúdos feitos pelos
usuários.

O Agent primeiro verifica o que já existe no banco e monta a hierarquia
completa:

```text
Matéria
  └── Grade
       └── Tópico
            └── Subtópico
                 └── Flashcards
```

Depois compara a estrutura existente com a estrutura necessária.

### Regra fundamental

**Não recriar o que já existe.**

Exemplo:

```text
Português
│
├── Morfologia
│   ├── Classes de palavras       ✓ existente
│   ├── Substantivo               ✓ existente
│   └── Adjetivo                  ✓ existente
│
└── Sintaxe
    ├── Termos da oração          ✓ existente
    └── Período composto          ✗ faltando
        ├── Orações coordenadas   ✗ faltando
        └── Orações subordinadas  ✗ faltando
```

Nesse caso o Agent trabalha somente em:

```text
Período composto
├── Orações coordenadas
└── Orações subordinadas
```

e gera os cards correspondentes.

Isso reduz chamadas de IA, evita duplicação e mantém a grade organizada.

---

## 4. Buscar novos conteúdos

O modo **Buscar novos conteúdos** é diferente do modo de atualização.

Ele serve para descobrir oportunidades de expansão do catálogo.

Fluxo:

```text
Pesquisar conteúdos relevantes
          ↓
Encontrar possíveis matérias
          ↓
Verificar se já existem
          ↓
Avaliar relevância
          ↓
Selecionar candidatos
          ↓
Criar matéria
          ↓
Criar grade
          ↓
Criar tópicos
          ↓
Criar subtópicos
          ↓
Gerar cards necessários
          ↓
Validar
          ↓
Publicar
```

### Importante

A descoberta é uma operação controlada e não deve ser executada em toda
execução automática.

Ao iniciar manualmente esse modo no GitHub Actions, existe também a opção:

**"Permitir que o Agent pesquise e adicione novos conteúdos?"**

Deixe desmarcada quando quiser apenas testar o fluxo sem permitir a
expansão do catálogo.

A descoberta deve respeitar os limites de matérias, tópicos, cards,
chamadas de IA e orçamento configurados nos secrets.

---

## 5. Limpeza de cards

O modo **Limpeza de cards** existe para controlar o crescimento do banco e
manter somente conteúdo relevante.

Ele não deve apagar cards simplesmente porque são antigos.

A decisão considera sinais como:

- quantidade de utilizações;
- recência de uso;
- desempenho dos usuários;
- feedback positivo/negativo;
- qualidade do card;
- relevância do tópico;
- existência de outros cards equivalentes;
- proteção mínima de cards por tópico/bucket.

### Dry-run obrigatório por segurança

A limpeza possui duas etapas:

```text
Limpeza
   ↓
Identificar candidatos
   ↓
DRY-RUN
   ↓
Revisar resultado
   ↓
Aplicar exclusão somente quando autorizado
```

No GitHub Actions existe a opção:

**"Na limpeza, apagar realmente os candidatos? Desmarcado = apenas
simulação (dry-run)"**

Recomendação: execute primeiro com a opção desmarcada.

Somente depois de verificar os candidatos, execute novamente permitindo a
exclusão.

### Proteção contra limpeza excessiva

A configuração possui limites para quantidade de cards analisados,
dias sem uso e quantidade mínima de cards que devem permanecer.

O objetivo é reduzir o banco sem destruir a cobertura de conteúdo.

---

# Como executar pelo GitHub Actions

O workflow fica em:

```text
.github/workflows/content-agent.yml
```

No GitHub:

```text
Actions
  ↓
content-agent
  ↓
Run workflow
```

Você verá o campo:

```text
Escolha o modo de funcionamento do Agent
```

com as opções:

```text
Automático
Correção de cards
Atualizar conteúdos solicitados
Buscar novos conteúdos
Limpeza de cards
```

## Configuração recomendada para cada modo

### Correção de cards

```text
Modo: Correção de cards
Descoberta de novos conteúdos: desmarcada
```

### Atualizar conteúdos solicitados

```text
Modo: Atualizar conteúdos solicitados
Descoberta de novos conteúdos: desmarcada
```

### Buscar novos conteúdos

```text
Modo: Buscar novos conteúdos
Permitir descoberta: marcada
```

### Limpeza

Primeiro:

```text
Modo: Limpeza de cards
Apagar candidatos: desmarcado
```

Depois de conferir o resultado:

```text
Modo: Limpeza de cards
Apagar candidatos: marcado
```

### Automático

```text
Modo: Automático
Permitir descoberta: desmarcada
```

Essa é a configuração mais segura para a execução periódica.

---

# Execução automática semanal

O workflow possui um agendamento semanal:

```yaml
schedule:
  - cron: '7 3 * * 0'
```

Como a execução agendada não recebe os campos do formulário manual, ela cai
no modo **Automático** e mantém a descoberta desativada.

Assim o agendamento semanal não começa a gerar conteúdo novo sem uma
necessidade identificada.

---

# Arquitetura do fluxo

A visão simplificada é:

```text
                    ┌─────────────────────┐
                    │   GitHub Actions    │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Escolha do modo   │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
     CORREÇÃO              ATUALIZAÇÃO          DESCOBERTA
          │                    │                    │
          ▼                    ▼                    ▼
      Feedback            Solicitações          Pesquisa
          │                    │                    │
          ▼                    ▼                    ▼
       Card                Conteúdo             Conteúdo
       errado              faltante              novo
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
                         Validação/Qualidade
                               │
                               ▼
                            Firestore
                               │
                               ▼
                            FlashMind

                       LIMPEZA fica separada
                               │
                               ▼
                     Relevância + utilização
                               │
                       ┌───────┴───────┐
                       ▼               ▼
                    preservar       candidato
                                       │
                                      dry-run
                                       │
                                  exclusão autorizada
```

---

# Princípios de segurança do Agent

## 1. Não gerar sem necessidade

O Agent deve sempre procurar uma justificativa para gerar conteúdo:

- feedback que exige correção;
- solicitação de usuário;
- lacuna identificada em conteúdo solicitado;
- descoberta explicitamente autorizada.

Se nenhuma dessas condições existir, ele deve encerrar sem gerar cards.

## 2. Não duplicar

Antes de criar uma matéria, grade, tópico, subtópico ou card, o Agent deve
consultar o conteúdo existente.

## 3. Limitar custo

As execuções possuem limites configuráveis para:

- tempo;
- chamadas de IA;
- cards por execução;
- tópicos;
- tentativas;
- orçamento por execução.

## 4. Validar antes de publicar

Cards gerados passam pelas validações de qualidade e deduplicação antes de
serem publicados.

## 5. Registrar alterações

As operações importantes são registradas para permitir auditoria e
investigação de problemas.

---

# Configuração das APIs

O Agent utiliza o Gemini como provedor principal. DeepSeek e OpenAI podem
ser configurados como alternativas/fallback conforme a configuração do
ambiente.

Nunca coloque chaves diretamente no código.

Use `.env` localmente ou **GitHub Actions Secrets** em produção.

Principais variáveis:

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY

GEMINI_API_KEY
GEMINI_MODEL

DEEPSEEK_API_KEY
DEEPSEEK_MODEL

OPENAI_API_KEY
OPENAI_MODEL
```

Os limites do Agent também são configuráveis por variáveis de ambiente.
Consulte `env.example` para a lista completa.

---

# Requisitos

- Node.js 20+
- Projeto Firebase com Firestore
- Service Account com permissão adequada do Admin SDK
- Chave de API do Gemini (`GEMINI_API_KEY`)
- DeepSeek/OpenAI são opcionais

---

# Uso local

```bash
npm install
cp env.example .env
```

Preencha as credenciais e execute:

```bash
npm run dev
```

Para validar antes da execução:

```bash
npm run typecheck
npm test
npm run build
```

Para executar o build:

```bash
node dist/content-agent.cjs
```

---

# Build e deploy

```bash
npm run build
node dist/content-agent.cjs
```

Deploy recomendado: **GitHub Actions** com o workflow
`.github/workflows/content-agent.yml`.

Também é possível usar Cloud Run Jobs + Cloud Scheduler com o `Dockerfile`
incluso.

Consulte `docs/DEPLOYMENT.md` para detalhes de implantação.

---

# Reverter uma revisão automática

```bash
npm run rollback -- "Português" "Regência" medio definition
```

---

# Testes

```bash
npm test
npm run test:watch
npm run typecheck
```

Os testes cobrem os principais componentes de planejamento, feedback,
aprendizado, atualização de cards, currículo, limpeza e execução dos modos.

---

# Dados compartilhados com o FlashMind

Este repositório contém somente o Agent. O app FlashMind continua separado.

Coleções principais utilizadas pelo Agent:

- `subjects` — matérias;
- `curricula` — grades e hierarquia de conteúdo;
- `cardBuckets` — conjuntos de flashcards por tópico/subtópico;
- `cardFeedback` — feedback enviado pelos usuários;
- `agentRuns` — registro das execuções;
- `contentAdaptations` — adaptações realizadas pelo Agent;
- `cardRevisionHistory` — histórico de alterações dos cards.

As regras de segurança do Firestore e o dashboard administrativo ficam no
repositório do app FlashMind, não neste repositório.

---

# Documentação complementar

- `docs/ARCHITECTURE.md` — arquitetura do Agent;
- `docs/DEPLOYMENT.md` — implantação;
- `docs/PRODUCTION_CHECKLIST.md` — checklist de produção;
- `docs/AGENT_MODES.md` — detalhes dos modos de execução;
- `env.example` — variáveis de configuração.

---

## Regra de ouro

**O MemoriaFlashAgent não existe para gerar o máximo de cards possível.**

Ele existe para manter o banco do FlashMind **correto, completo, atualizado,
relevante e controlado**, gerando conteúdo somente quando houver uma
necessidade real.
