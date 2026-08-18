# Alimentador de Conteúdo `completo.mflash`

O MemoriaFlashAgent possui um modo adicional chamado `content_importer`. Ele recebe um único pacote editorial `completo.mflash`, valida o conteúdo, cria um staging, executa dry-run, compara com o Firebase e publica em lotes. **A importação não usa API de IA.**

## Níveis oficiais

O pacote completo deve declarar exatamente estes níveis:

- `fundamental` — FUNDAMENTAL
- `medio` — MÉDIO
- `faculdade` — FACULDADE
- `concurso` — CONCURSO
- `tecnico` — TÉCNICO

Uma matéria só deve aparecer nos níveis em que realmente se aplica. Não copie uma grade de um nível para outro apenas para preencher a estrutura. Uma matéria específica de concurso, por exemplo, deve permanecer em CONCURSO.

## Hierarquia

```text
NÍVEL
  └── MATÉRIA
       └── GRADE
            └── TÓPICO
                 └── SUBTÓPICO
                      └── CARDS
```

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

O arquivo real precisa conter os cinco níveis. O exemplo acima mostra somente a estrutura de um nível para facilitar a leitura.

## Regras de produção

1. `format` deve ser `memoriaflash`.
2. `formatVersion` deve ser `1.0`.
3. `package` deve ser `completo`.
4. `contentVersion` é obrigatório.
5. Os cinco níveis oficiais devem existir no pacote e no manifesto.
6. IDs de cards devem ser únicos.
7. Conteúdo duplicado é detectado por hash.
8. Pergunta/front e resposta/back são obrigatórios.
9. Cards de qualidade baixa são rejeitados pelo validador determinístico.
10. O importador não exclui cards automaticamente.
11. Conflitos de ID/conteúdo bloqueiam a publicação.
12. O tamanho estimado do pacote e o uso lógico do Firestore são verificados antes da publicação.
13. A publicação ocorre em lotes e possui histórico de importação.
14. O conteúdo editorial não sobrescreve dados de uso, progresso ou feedback dos usuários.

## Fluxo de publicação

```text
completo.mflash
      ↓
validação
      ↓
staging
      ↓
dry-run
      ↓
aprovação
      ↓
importação em lotes
      ↓
pós-validação
      ↓
Firebase
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

Abra o endereço configurado. O dashboard permite selecionar o `completo.mflash`, validar, colocar em staging, visualizar o dry-run e publicar.

Em produção, sempre use `ADMIN_DASHBOARD_TOKEN` e mantenha o dashboard atrás de uma rede/proxy privado. Não exponha o painel publicamente sem autenticação adicional.

## Publicação pelo modo do Agent

Depois que um pacote foi colocado em staging e aprovado, o worker pode publicar o job:

```env
CONTENT_AGENT_MODE=content_importer
CONTENT_IMPORT_JOB_ID=<ID_DO_JOB>
CONTENT_AGENT_PRODUCTION_STRICT=true
```

Então:

```bash
npm run build
npm start
```

Esse modo não exige Gemini, DeepSeek ou OpenAI. Ele precisa apenas do Firebase Admin e das configurações de segurança.

## Limite de armazenamento

A auditoria e o importador usam uma referência configurável:

```env
FIRESTORE_FREE_STORAGE_BYTES=1073741824
CONTENT_IMPORT_MAX_STORAGE_PERCENT=95
```

O percentual é uma **estimativa lógica dos documentos retornados pelo Firestore**. Não substitui o número oficial do Google Cloud, que inclui overhead de índices e metadados.

## Segurança e recuperação

- O pacote é hashado com SHA-256.
- O staging registra o job, manifesto, estatísticas, problemas e hash.
- O arquivo é armazenado em chunks no staging para não depender do limite de 1 MiB de um único documento.
- A publicação é idempotente por `contentHash` e ID.
- Um card ausente na nova versão não é apagado automaticamente.
- O histórico permanece em `contentImportJobs`.
- O importador verifica o tamanho de cada bucket antes de publicar.

## Checklist operacional

Antes da primeira importação real:

- [ ] Firebase Admin configurado.
- [ ] `CONTENT_AGENT_PRODUCTION_STRICT=true`.
- [ ] Token administrativo definido.
- [ ] `completo.mflash` validado.
- [ ] Os cinco níveis presentes.
- [ ] Dry-run sem erros críticos.
- [ ] Conflitos resolvidos.
- [ ] Percentual estimado do banco dentro do limite.
- [ ] Backup/política de rollback definida.
- [ ] Importação de teste executada.
- [ ] Aplicativo validado após publicação.
