# Geração de `.mflash` por nível

O MemoriaFlashAgent agora aceita dois formatos de pacote:

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

## Regra de geração

Para cada subtópico da grade:

1. o Agent solicita exatamente 50 flashcards à IA;
2. o prompt informa explicitamente o nível de ensino;
3. o prompt restringe a geração ao subtópico atual;
4. cards repetidos são filtrados;
5. se a IA retornar menos de 50 cards válidos, o Agent tenta novamente somente o restante;
6. a geração falha se não conseguir fechar exatamente a quantidade solicitada;
7. o pacote final contém todos os subtópicos da grade e `50 × quantidade_de_subtópicos` cards.

O número é configurável. Por exemplo, `20` gera 20 cards por subtópico:

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

O formato por nível passa pelo mesmo fluxo de segurança do pacote completo:

`validação → auditoria → staging → dry-run → aprovação → backup → publicação → pós-validação → rollback`

Assim, `Portugues_fundamental.mflash` pode ser importado sem exigir que os outros quatro níveis estejam presentes no mesmo arquivo.
