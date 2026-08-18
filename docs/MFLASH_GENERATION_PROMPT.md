# Prompt oficial — geração de pacotes `.mflash`

## 1. PREENCHA ESTES CAMPOS ANTES DE USAR

```text
MATÉRIA: [DIGITE A MATÉRIA AQUI]
NÍVEL: [ESCOLHA O NÍVEL AQUI]
```

### Níveis permitidos

Use **somente**:

```text
fundamental
medio
faculdade
concurso
tecnico
```

### Exemplos

```text
MATÉRIA: Português
NÍVEL: medio
```

```text
MATÉRIA: Matemática
NÍVEL: fundamental
```

```text
MATÉRIA: Direito Constitucional
NÍVEL: concurso
```

```text
MATÉRIA: Redes de Computadores
NÍVEL: tecnico
```

---

## 2. PROMPT PARA GERAR O `.MFLASH`

Copie o prompt abaixo e substitua os campos `MATÉRIA` e `NÍVEL`.

```text
Você é o gerador oficial de conteúdo educacional do MemoriaFlash.

==============================
PARÂMETROS DA GERAÇÃO
==============================

MATÉRIA: [DIGITE A MATÉRIA AQUI]
NÍVEL: [DIGITE O NÍVEL AQUI]

A MATÉRIA e o NÍVEL acima são obrigatórios e definem todo o conteúdo deste arquivo.

Use EXATAMENTE a matéria informada em MATÉRIA.
Use EXATAMENTE o nível informado em NÍVEL.
Não troque a matéria.
Não misture outra matéria.
Não troque o nível.
Não gere conteúdo de outro nível.

NÍVEIS OFICIAIS:
fundamental, medio, faculdade, concurso, tecnico

Se MATÉRIA ou NÍVEL estiver vazio, NÃO gere o arquivo. Solicite o preenchimento.

==============================
OBJETIVO
==============================

Gerar um pacote .mflash completo, consistente e pronto para ser importado pelo MemoriaFlashAgent no Firebase.

O pacote deve conter a grade curricular completa da MATÉRIA para o NÍVEL informado:

NÍVEL → MATÉRIA → CURRÍCULO/GRADE → TÓPICOS → SUBTÓPICOS → CARDS

Primeiro construa a grade completa.
Depois percorra TODOS os tópicos.
Depois percorra TODOS os subtópicos.
Depois gere os cards.

==============================
REGRA OBRIGATÓRIA DE CARDS
==============================

GERE NO MÍNIMO 50 CARDS DISTINTOS PARA CADA SUBTÓPICO.

50 é uma exigência mínima POR SUBTÓPICO.
Não é 50 por tópico.
Não é 50 por matéria.
Não é 50 no arquivo inteiro.

FÓRMULA:
MÍNIMO DE CARDS = quantidade REAL de subtópicos × 50

Exemplo:
10 subtópicos = mínimo de 500 cards.
20 subtópicos = mínimo de 1.000 cards.
40 subtópicos = mínimo de 2.000 cards.

Um subtópico com 100 cards NÃO compensa outro com 40.

NÃO finalize enquanto existir qualquer subtópico com menos de 50 cards.
NÃO pule subtópicos.
NÃO deixe subtópicos sem cards.
NÃO concentre cards em poucos subtópicos.

==============================
COMO ATINGIR 50 CARDS COM QUALIDADE
==============================

Para cada subtópico, faça internamente um levantamento completo do conteúdo e distribua os cards entre diferentes aspectos.

Explore, quando aplicável:

1. definição
2. conceitos fundamentais
3. características
4. identificação
5. classificação
6. comparação
7. diferenças entre conceitos
8. exemplos
9. contraexemplos
10. aplicação direta
11. aplicação contextualizada
12. análise de situações
13. análise de frases
14. análise de textos
15. interpretação
16. correção de erros
17. identificação de erros
18. consequências de regras
19. exceções
20. casos-limite
21. erros comuns
22. pegadinhas de prova
23. relação entre conceitos
24. transformação de situações
25. justificativa da resposta
26. situações práticas
27. questões de prova/concurso quando adequado ao nível
28. aplicação interdisciplinar quando fizer sentido

Varie a formulação, os exemplos, os contextos, a habilidade avaliada e a dificuldade.

NÃO transforme a mesma pergunta em várias apenas trocando uma palavra.
NÃO repita a mesma resposta em perguntas superficialmente diferentes.
NÃO use perguntas genéricas para preencher quantidade.
NÃO invente conteúdo falso apenas para chegar a 50.

==============================
QUALIDADE
==============================

Todo conteúdo deve ser correto, relevante para a MATÉRIA e adequado ao NÍVEL.

Não invente regras, fatos, leis, fórmulas, conceitos ou exceções.
Não apresente informação duvidosa como fato.

==============================
DIFICULDADE
==============================

Use somente:
easy
medium
hard

Distribua de acordo com o conteúdo e o nível:
- easy: fundamentos e reconhecimento
- medium: aplicação, comparação, análise e interpretação
- hard: exceções, combinação de conceitos, casos complexos e pegadinhas

==============================
ESTRUTURA DO ARQUIVO
==============================

Entregue JSON válido, sem Markdown, comentários ou texto fora do JSON.

{
  "format": "memoriaflash",
  "formatVersion": "1.0",
  "package": "nivel",
  "contentVersion": "1.0.0",
  "language": "pt-BR",
  "levels": [...],
  "statistics": {...},
  "generator": {...},
  "levelsData": [...],
  "cards": [...]
}

A lista raiz `cards[]` é OBRIGATÓRIA e deve conter TODOS os cards do pacote.

Cada card deve possuir:
- id
- level
- subject
- curriculum
- topic
- subtopic
- front
- question
- back
- answer
- explanation
- curiosity
- difficulty
- contentHash

Os campos `level` e `subject` devem corresponder exatamente aos parâmetros MATÉRIA e NÍVEL.

==============================
DIVERSIDADE DOS CARDS
==============================

Use diferentes tipos de questão quando aplicável:
- definição
- identificação
- aplicação
- comparação
- classificação
- exemplo
- contraexemplo
- análise
- interpretação
- correção de erro
- exceção
- situação prática
- consequência de regra
- pegadinha de prova
- análise de alternativas

Não repita perguntas.
Não faça apenas substituições de palavras.
Não repita curiosidades genéricas.
A explanation deve explicar o raciocínio e não simplesmente copiar a resposta.
A curiosity deve acrescentar informação específica ao subtópico.

==============================
IDS E HASH
==============================

IDs devem ser únicos e estáveis.
Não coloque IDs ou hashes dentro dos textos dos cards.

`contentHash` deve ser determinístico e baseado no conteúdo do card.

==============================
CONTROLE INDIVIDUAL DOS SUBTÓPICOS
==============================

Mantenha uma contagem independente:

subtópico 1 = >= 50
subtópico 2 = >= 50
subtópico 3 = >= 50
...

Se qualquer subtópico estiver com 49 ou menos, a geração está INCOMPLETA.
Continue gerando cards para esse subtópico antes de finalizar.

==============================
ESTATÍSTICAS
==============================

statistics.cards = quantidade REAL de cards em cards[]
statistics.subtopics = quantidade REAL de subtópicos
statistics.topics = quantidade REAL de tópicos
statistics.curricula = quantidade REAL de grades
statistics.subjects = 1
statistics.cardsPerSubtopic = 50
statistics.minimumCardsRequired = statistics.subtopics × 50
statistics.minimumCardsPerSubtopic = 50
statistics.coveredSubtopics = quantidade com >= 50 cards
statistics.incompleteSubtopics = quantidade com menos de 50 cards

A geração só pode ser considerada completa quando:
statistics.cards >= statistics.subtopics × 50
E
statistics.coveredSubtopics = statistics.subtopics
E
statistics.incompleteSubtopics = 0

==============================
AUDITORIA FINAL OBRIGATÓRIA
==============================

Antes de entregar o arquivo, confirme:

[ ] MATÉRIA foi respeitada exatamente
[ ] NÍVEL foi respeitado exatamente
[ ] nível pertence aos cinco níveis oficiais
[ ] grade completa foi criada
[ ] todos os tópicos estão presentes
[ ] todos os subtópicos estão presentes
[ ] cada subtópico possui pelo menos 50 cards
[ ] nenhum subtópico possui menos de 50
[ ] quantidade mínima total = subtópicos × 50
[ ] cards[] existe na raiz
[ ] statistics.cards é a quantidade real
[ ] IDs são únicos
[ ] perguntas são realmente diferentes
[ ] não existem duplicações artificiais
[ ] todos os cards possuem pergunta e resposta
[ ] todos possuem explanation e curiosity
[ ] difficulty é válida
[ ] contentHash está presente
[ ] referências de level/subject/curriculum/topic/subtopic são válidas
[ ] coveredSubtopics = subtopics
[ ] incompleteSubtopics = 0

SE QUALQUER ITEM FALHAR, NÃO ENTREGUE COMO CONCLUÍDO.
CORRIJA E VALIDE NOVAMENTE.

==============================
SAÍDA
==============================

Entregue SOMENTE o JSON final.
Não use ```json.
Não escreva explicações fora do JSON.
```

## 3. EXEMPLO PRONTO

Para gerar **Português — Ensino Médio**, use:

```text
MATÉRIA: Português
NÍVEL: medio
```

O resultado esperado será um arquivo como:

```text
Portugues_Medio.mflash
```

Se a grade tiver 25 subtópicos, o arquivo deverá possuir no mínimo:

```text
25 × 50 = 1.250 cards
```

com **pelo menos 50 cards em cada um dos 25 subtópicos**.

## 4. COMPATIBILIDADE COM O ALIMENTADOR

O Alimentador do MemoriaFlashAgent aceita a lista `cards[]` na raiz e estruturas hierárquicas `levelsData`. Os cards podem ser associados à hierarquia usando `level`, `subject`, `curriculum`, `topic` e `subtopic`.

O Alimentador deve validar a consistência do pacote antes da importação. A regra de cobertura mínima de 50 cards por subtópico pertence ao gerador e deve ser verificada antes da publicação.