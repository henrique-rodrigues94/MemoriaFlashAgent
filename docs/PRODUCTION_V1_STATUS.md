# MemoriaFlashAgent — V1 Production Status

## Implementado no código

- [x] Production gate com `CONTENT_AGENT_PRODUCTION_STRICT=true`.
- [x] Validação de credenciais essenciais antes da execução.
- [x] Limites de runtime, chamadas de IA e cards validados no gate.
- [x] Lease distribuído no Firestore (`agentLocks/global`) para impedir workers concorrentes.
- [x] Lease com expiração para recuperação após worker morto.
- [x] Release do lease no `finally`.
- [x] CI com `npm ci`, audit de dependências, typecheck, testes e build.
- [x] Workflow de produção sem permissões de escrita no GitHub.
- [x] Execução agendada com `concurrency` do GitHub Actions.
- [x] Container de produção executado como usuário não-root.
- [x] Variáveis de produção documentadas no `env.example`.
- [x] Testes automatizados do production gate.
- [x] Quality Gate e proveniência já existentes preservados.
- [x] Retry, recuperação de requests travados, métricas e controle de custo já existentes preservados.

## Bloqueios que não podem ser falsamente marcados como concluídos pelo código

Os itens abaixo dependem do ambiente Firebase/Google Cloud real e precisam ser executados antes do GO final:

1. Auditar e testar `firestore.rules` no projeto Firebase de produção.
2. Confirmar que service account possui somente as permissões necessárias.
3. Configurar Secret Manager/secret store e rotacionar qualquer credencial que tenha sido exposta fora dele.
4. Configurar alertas de billing/orçamento do Google Cloud/Firebase.
5. Configurar e testar backup/restore do Firestore.
6. Executar E2E real PDF/TXT → Firestore em staging.
7. Executar teste de dois workers simultâneos contra Firestore de staging.
8. Executar teste de falha/reconexão do Firestore e dos providers de IA.
9. Definir RPO/RTO e executar o procedimento de disaster recovery.
10. Validar retenção/LGPD no ambiente real.

**Regra:** a V1 só recebe status `GO` depois que os bloqueios acima forem comprovados em staging/produção controlada. O código não deve marcar esses itens automaticamente.
