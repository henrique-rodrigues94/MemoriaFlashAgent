# Geração de `.mflash` por nível

O MemoriaFlashAgent aceita dois formatos de pacote:

- `completo.mflash`: pacote com os cinco níveis oficiais;
- `<Materia>_<nivel>.mflash`: pacote individual de um nível.

## Exemplo

```powershell
npm run content:generate-level -- "Português" fundamental 50 ./generated-mflash
```

Resultado esperado:

```text
generated-mflash/Portugues_fundamental.mflash
```

O nome do arquivo usa o slug da matéria. O conteúdo é gerado a partir da grade curricular já existente no Firestore para `Português/fundamental`.

## Regra de geração atualizada

O valor `50` por subtópico é uma **meta de cobertura**, não uma licença para repetir cards.

O gerador deve:

1. cobrir todos os tópicos e subtópicos existentes na grade;
2. variar tipos de questão e dificuldade de forma pedagogicamente útil;
3. rejeitar perguntas, respostas ou explicações artificialmente repetidas;
4. não colocar IDs ou hashes dentro do texto das perguntas;
5. manter IDs únicos e `contentHash` determinístico;
6. gerar a quantidade solicitada somente quando houver conteúdo realmente útil para isso;
7. sinalizar cobertura incompleta quando atingir a meta exigir repetição artificial;
8. manter `cards[]` na raiz do `.mflash` com todos os cards;
9. quando `levelsData[].cards` também existir, manter quantidade e IDs consistentes com `cards[]`;
10. validar JSON, hierarquia, estatísticas e referências antes de entregar o arquivo.

O prompt oficial completo está em `docs/MFLASH_GENERATION_PROMPT.md`.

O número continua configurável. Por exemplo:

```powershell
npm run content:generate-level -- "Português" fundamental 20 ./generated-mflash
```

## Níveis aceitos

- `fundamental`
- `medio`
- `faculdade`
- `concurso`
- `tecnico`

## Importação

O Alimentador aceita tanto a estrutura hierárquica oficial quanto o formato editorial `levelsData`. A lista raiz `cards[]` também é aceita como fonte de fallback quando a hierarquia não contém cards.

Antes da publicação, o Agent verifica:

- quantidade de cards declarada versus encontrada;
- consistência entre `cards[]` e `levelsData[].cards` quando ambas existem;
- IDs duplicados;
- qualidade mínima;
- estrutura matéria → grade → tópico → subtópico;
- conflitos com o Firebase;
- impacto de armazenamento.

O fluxo continua:

`validação → auditoria → staging → dry-run → aprovação → backup → publicação → pós-validação → rollback`
