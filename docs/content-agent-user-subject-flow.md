# Fluxo de matéria/assunto digitado pelo usuário

O Content Agent agora funciona como uma fábrica de conteúdo compartilhado.

## 1. O app recebe a matéria

Quando o usuário digitar, por exemplo:

- `Biologia`
- `Direito Penal`
- `Perito Criminal - Informática`
- `Excel Avançado`

O backend do FlashMind deve criar um documento em `contentRequests/{requestId}`:

```json
{
  "subject": "Biologia",
  "educationLevel": "medio",
  "status": "pending",
  "requestedAt": "2026-08-15T14:00:00.000Z",
  "updatedAt": "2026-08-15T14:00:00.000Z"
}
```

`educationLevel` é opcional. Se não for enviado, o agente usa a IA para descobrir os níveis relevantes.

## 2. Descoberta inteligente

O agente:

1. procura a matéria em `subjects`;
2. se não existir, identifica os níveis relevantes;
3. procura a grade em `curricula`;
4. se não existir, cria uma grade hierárquica;
5. se existir uma grade antiga sem subtópicos, enriquece essa grade em vez de começar do zero.

## 3. Grade criada

O modelo lógico é:

```text
Matéria
└── Nível
    ├── Categoria
    │   ├── Tópico
    │   │   ├── Subtópico
    │   │   ├── Subtópico
    │   │   └── Subtópico
    │   └── Tópico
    │       ├── Subtópico
    │       └── Subtópico
    └── Categoria...
```

O campo antigo `topics: string[]` continua sendo preservado para não quebrar o aplicativo atual. O novo mapa `subtopics` fica junto da categoria.

## 4. Geração de cards

A unidade de geração passou a ser a folha da grade, ou seja, o subtópico.

Exemplo:

```text
Biologia
└── Citologia
    └── Membrana plasmática
        ├── Estrutura do modelo mosaico fluido
        ├── Transporte passivo
        ├── Transporte ativo
        └── Endocitose e exocitose
```

Cada folha recebe seus próprios `cardBuckets`, evitando misturar cards de conceitos diferentes.

Quando existe hierarquia, a chave do tópico do bucket fica como:

`Membrana plasmática > Transporte passivo`

Isso evita colisões quando dois tópicos diferentes possuem subtópicos com o mesmo nome.

## 5. Processamento incremental

O agente não tenta criar uma matéria inteira em uma única chamada de IA.

Limites padrão:

- até 2 pedidos de usuários por execução;
- até 12 folhas por pedido em cada ciclo;
- até 20 cards por lote;
- até 500 cards por execução;
- até 50 chamadas de IA por execução.

Se uma matéria for grande, `contentRequests/{id}` continua como `processing` e o próximo ciclo continua de onde parou.

Quando todas as folhas relevantes atingirem o objetivo de cards, o pedido vira `completed`.

## 6. Execução automática

O workflow do agente foi configurado para verificar novos pedidos a cada 15 minutos, além de permitir execução manual.

Para produção com resposta realmente imediata, a arquitetura recomendada é executar o agente como serviço Cloud Run e fazer o backend do FlashMind chamar a fila/API diretamente. O Firestore continua sendo a fonte compartilhada e o mecanismo de retomada.
