# Pipeline de documentos — V1

A V1 aceita **PDF e TXT**. O aplicativo extrai o texto e grava o pedido autenticado em `contentRequests/{requestId}`. O texto é dividido em `sourceChunks` para não colocar um documento grande em um único documento Firestore.

## Fluxo

```text
PDF/TXT
  -> extração de texto no app
  -> contentRequests/{requestId}
  -> sourceChunks/{chunkId}
  -> Content Agent semanal
  -> identificação de nível
  -> grade: categoria > tópico > subtópico
  -> geração em lotes
  -> deduplicação
  -> cardBuckets
  -> contentIndex
```

## Limites V1

- até 80 chunks;
- até 12.000 caracteres por chunk;
- aproximadamente 960 mil caracteres de fonte por documento;
- apenas `application/pdf` e `text/plain` no pipeline do Agent.

## Segurança

O usuário autenticado só pode criar e consultar o próprio `contentRequest` e seus `sourceChunks`. Status, progresso, currículo e cards são alterados pelo Admin SDK/Agent.

## Economia

A grade é criada uma vez por matéria/nível quando possível. Os cards são gerados em lotes, com deduplicação e reutilização do banco compartilhado. Para documentos, o Agent seleciona trechos da fonte relevantes ao subtópico antes de chamar o provedor de IA.
