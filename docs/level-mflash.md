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

## Geração incremental e retomável

A geração por nível **não depende de uma única resposta gigante da IA**.

O fluxo é:

1. carregar e congelar a grade;
2. remover duplicações da grade;
3. processar um subtópico por vez;
4. solicitar somente os cards necessários para aquele subtópico;
5. validar a quantidade e remover duplicações;
6. salvar um checkpoint local depois de cada subtópico concluído;
7. continuar no próximo subtópico;
8. montar o `.mflash` somente depois que todos os subtópicos estiverem completos;
9. validar o pacote final;
10. remover o checkpoint após a conclusão com sucesso.

O checkpoint fica ao lado do arquivo como:

```text
generated-mflash/Portugues_fundamental.mflash.state.json
```

Se a execução for interrompida por erro, queda de internet, limite da API ou encerramento do processo, basta executar o mesmo comando novamente. Os subtópicos já concluídos são pulados e a geração continua do ponto salvo. Um checkpoint só é aceito quando matéria, nível, quantidade por subtópico e assinatura da grade continuam iguais.

O arquivo `.mflash` final só é escrito de forma atômica depois da validação de todos os subtópicos. Portanto, uma geração incompleta não deve ser apresentada como pacote final.

## Regra de geração

O valor `50` por subtópico é a **meta padrão de cobertura**.

O gerador deve:

1. cobrir todos os tópicos e subtópicos existentes na grade;
2. variar tipos de questão e dificuldade de forma pedagogicamente útil;
3. rejeitar perguntas, respostas ou explicações artificialmente repetidas;
4. não colocar IDs ou hashes dentro do texto das perguntas;
5. manter IDs únicos e `contentHash` determinístico quando o formato exigir;
6. completar a meta somente com conteúdo realmente útil;
7. nunca declarar uma quantidade maior do que a quantidade de cards reais;
8. não montar o pacote final enquanto existir subtópico incompleto;
9. calcular as estatísticas a partir dos cards realmente gerados;
10. validar JSON, hierarquia, estatísticas e referências antes de entregar o arquivo.

Se um subtópico não conseguir atingir a meta após as tentativas configuradas, a execução falha mantendo o checkpoint. Isso evita criar um `.mflash` parcialmente preenchido ou mascarar a falta de conteúdo.

O prompt oficial completo está em `docs/MFLASH_GENERATION_PROMPT.md`.

## Quantidade configurável

O padrão é 50 cards por subtópico, mas o número continua configurável para testes:

```powershell
npm run content:generate-level -- "Português" fundamental 20 ./generated-mflash
```

Para produção do pacote completo por nível, use 50.

## Níveis aceitos

- `fundamental`
- `medio`
- `faculdade`
- `concurso`
- `tecnico`

## Importação

O Alimentador aceita pacotes completos e pacotes por nível. Antes da publicação, o Agent verifica:

- quantidade de cards declarada versus encontrada;
- IDs duplicados;
- qualidade mínima;
- estrutura matéria → grade → tópico → subtópico;
- conflitos com o Firebase;
- impacto de armazenamento.

O fluxo continua:

`geração incremental → validação → auditoria → staging → dry-run → aprovação → backup → publicação → pós-validação → rollback`
