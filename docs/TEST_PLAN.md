# Plano de teste

## Fluxo operacional em simulação

1. Entrar; 2. configurar dados básicos; 3. importar CSV; 4. criar lote; 5. ativar simulação; 6. iniciar lote; 7. worker selecionar lead; 8. gerar abertura; 9. simular envio; 10. simular resposta; 11. Francisco responder; 12. marcar interesse; 13. propor horário; 14. confirmar; 15. criar demonstração; 16. transferir; 17. enviar mensagem manual; 18. devolver ao Francisco; 19. solicitar remoção; 20. confirmar que novas mensagens estão bloqueadas.

O fluxo é coberto por integração da API/worker e pelas jornadas Playwright da interface. Execute `pnpm test` e `pnpm test:e2e`.

## Falhas obrigatórias

- Groq 429: respeitar `Retry-After`, manter limites e devolver à fila;
- WhatsApp desconectado: adiar envio real e notificar;
- webhook duplicado: retornar `{ duplicate: true }` e não criar outro job;
- worker reiniciado: fila persistente/idempotência impedem duplicação;
- material arquivado: seleção e envio automático bloqueados, histórico preservado;
- conflito de agenda: API retorna 409 e trigger do banco rejeita sobreposição.

## Validação real

Somente após credenciais válidas, health verde e confirmação explícita. Use exclusivamente o número de teste informado pelo usuário. Reative a simulação imediatamente depois do ensaio.
