# Alimentador de Conteúdo `completo.mflash`

O MemoriaFlashAgent possui um modo adicional chamado `content_importer`. Ele recebe um pacote editorial `completo.mflash`, valida o conteúdo, cria um staging, executa dry-run, audita a qualidade, compara com o Firebase e publica em lotes. **A importação não usa API de IA.** Os demais modos do Agent continuam funcionando normalmente.

## Níveis oficiais

O pacote completo usa exatamente estes cinco níveis:

- `fundamental` — FUNDAMENTAL
- `medio` — MÉDIO
- `faculdade` — FACULDADE
- `concurso` — CONCURSO
- `tecnico` — TÉCNICO

Uma matéria só deve aparecer nos níveis em que realmente se aplica. Não copie uma grade de um nível para outro apenas para preencher a estrutura.

## Hierarquia

```text
NÍVEL
  └── MATÉRIA
       └── GRADE
            └── TÓPICO
                 └── SUBTÓPICO
                      └── CARDS
```

## O que foi incorporado ao planejamento

O alimentador agora trata o arquivo como um **pacote editorial versionado**, e não como uma simples carga de JSON.

### Segurança

- SHA-256 do arquivo é calculado no staging.
- O hash é conferido novamente ao carregar o staging.
- O importador usa lock para impedir duas publicações simultâneas.
- É feito backup dos documentos que serão alterados antes da publicação.
- Existe rollback por `jobId`.
- Cards ausentes da nova versão **não são apagados automaticamente**.
- Conflitos de ID/conteúdo bloqueiam a publicação.
- Buckets que excedem o tamanho seguro do Firestore bloqueiam a publicação.

### Qualidade sem IA

O staging executa uma auditoria determinística adicional:

- cobertura por nível;
- matérias, tópicos e subtópicos;
- subtópicos sem cards;
- subtópicos abaixo do mínimo configurado;
- duplicados exatos;
- candidatos a duplicação por similaridade textual;
- hash de qualidade do relatório.

Duplicação por similaridade é **aviso**, não exclusão automática. O conteúdo nunca é apagado somente porque duas perguntas parecem parecidas.

Execute localmente antes de publicar:

```bash
npm run content:analyze -- ./completo.mflash
```

### Controle de armazenamento e custo

O staging estima:

- armazenamento atual;
- armazenamento adicional;
- armazenamento após importação;
- percentual estimado do limite configurado;
- quantidade de escritas;
- limite seguro por execução;
- referência diária de escritas.

A importação é bloqueada quando ultrapassa os limites de segurança configurados.

### Idempotência e versionamento

Cada card usa ID e `contentHash`. Reimportar o mesmo conteúdo não deve criar cópias. Cards iguais são ignorados; cards com o mesmo ID e conteúdo diferente podem ser atualizados; conflitos de identidade são bloqueados.

O histórico fica em `contentImportJobs`.

## Estratégia de importação

Configure `CONTENT_IMPORT_STRATEGY` para registrar a intenção da publicação:

```env
CONTENT_IMPORT_STRATEGY=sync
```

Valores planejados:

```text
add_only
sync
controlled_replace
```

A regra de segurança permanece: nenhuma estratégia remove cards automaticamente. Ausências devem ser tratadas como candidatos a revisão.

## Formato mínimo

```json
{
  "manifest": {
    "format": "memoriaflash",
    "formatVersion": "1.0",
    "package": "completo",
    "contentVersion": "1.0.0",
    "language": "pt-BR",
    "levels": ["fundamental", "medio", "faculdade", "concurso", "tecnico"],
    "statistics": {
      "subjects": 0,
      "curricula": 0,
      "topics": 0,
      "subtopics": 0,
      "cards": 0
    }
  },
  "levels": [
    {
      "id": "fundamental",
      "name": "FUNDAMENTAL",
      "subjects": [
        {
          "id": "portugues-fundamental",
          "name": "Português",
          "curricula": [
            {
              "id": "portugues-completo",
              "name": "Grade completa",
              "topics": [
                {
                  "id": "gramatica",
                  "name": "Gramática",
                  "subtopics": [
                    {
                      "id": "substantivo",
                      "name": "Substantivo",
                      "cards": [
                        {
                          "id": "pt-fundamental-substantivo-001",
                          "question": "O que é um substantivo?",
                          "answer": "É a palavra usada para nomear seres, objetos, lugares, sentimentos ou conceitos.",
                          "explanation": "O substantivo dá nome a elementos concretos ou abstratos.",
                          "curiosity": "Nomes próprios são substantivos próprios.",
                          "difficulty": "medium",
                          "curriculumPriority": 5
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

O arquivo real precisa conter os cinco níveis.

## Fluxo de publicação

```text
completo.mflash
      ↓
validação estrutural
      ↓
auditoria de qualidade
      ↓
comparação com Firebase
      ↓
estimativa de armazenamento/quota
      ↓
staging + SHA-256
      ↓
dry-run
      ↓
aprovação
      ↓
backup
      ↓
importação em lotes
      ↓
pós-validação
      ↓
PUBLISHED
```

## Dashboard administrativo

Configure:

```env
ADMIN_DASHBOARD_HOST=127.0.0.1
ADMIN_DASHBOARD_PORT=8787
ADMIN_DASHBOARD_TOKEN=um-token-longo-e-aleatorio
```

Execute:

```bash
npm run build:admin
npm run start:admin
```

O dashboard permite selecionar o `.mflash`, criar staging, visualizar o dry-run, publicar, cancelar e executar rollback.

Em produção, sempre use `ADMIN_DASHBOARD_TOKEN` e mantenha o dashboard atrás de uma rede/proxy privado. Não exponha o painel publicamente sem autenticação adicional.

## Publicação pelo modo do Agent

Depois que um pacote foi colocado em staging e aprovado, o worker pode publicar o job:

```env
CONTENT_AGENT_MODE=content_importer
CONTENT_IMPORT_JOB_ID=<ID_DO_JOB>
CONTENT_AGENT_PRODUCTION_STRICT=true
```

Esse modo não exige Gemini, DeepSeek ou OpenAI. Ele precisa apenas do Firebase Admin e das configurações de segurança.

## Limites recomendados

```env
FIRESTORE_FREE_STORAGE_BYTES=1073741824
CONTENT_IMPORT_MAX_STORAGE_PERCENT=95
CONTENT_IMPORT_MAX_BYTES=52428800
CONTENT_IMPORT_MAX_WRITES_PER_RUN=15000
FIRESTORE_FREE_WRITES_PER_DAY=20000
CONTENT_IMPORT_MIN_CARDS_PER_SUBTOPIC=1
CONTENT_IMPORT_SIMILARITY_THRESHOLD=0.92
CONTENT_IMPORT_MAX_SIMILARITY_CANDIDATES=200
```

O percentual de armazenamento é uma **estimativa lógica dos documentos retornados pelo Firestore**. Não substitui o número oficial do Google Cloud, que inclui overhead de índices e metadados.

## Checklist operacional

Antes da primeira importação real:

- [ ] Firebase Admin configurado.
- [ ] `CONTENT_AGENT_PRODUCTION_STRICT=true`.
- [ ] Token administrativo definido.
- [ ] `.mflash` validado.
- [ ] Os cinco níveis presentes.
- [ ] `npm run content:analyze -- arquivo.mflash` sem erros críticos.
- [ ] Dry-run sem erros críticos.
- [ ] Duplicações e conflitos revisados.
- [ ] Cobertura da grade revisada.
- [ ] Percentual estimado do banco dentro do limite.
- [ ] Quota de escritas dentro do limite.
- [ ] Backup/política de rollback definida.
- [ ] Importação de teste executada.
- [ ] Aplicativo validado após publicação.
