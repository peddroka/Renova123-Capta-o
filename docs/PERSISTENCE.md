# Persistência, API e worker

## Modelo canônico

As migrations `20260803000400` a `20260803000700` complementam o baseline sem destruir as tabelas legadas. O modelo canônico contém configurações, perfil e instruções do Francisco, conhecimento, templates, lotes e membros, eventos de lead, conversas e memórias, mensagens, agenda, integrações, auditoria, uso diário, heartbeat e dead letter.

O histórico de um lead não depende apenas de `leads.stage`: toda inserção e mudança de estágio gera uma linha em `lead_events`. Os estados requeridos convivem com os estados legados para permitir migração progressiva.

## Filas

As filas persistentes são:

- `outreach_queue`;
- `ai_response_queue`;
- `follow_up_queue`.

Cada fila possui prioridade, disponibilidade, lock, worker proprietário, tentativas, máximo de tentativas, erro, chave de deduplicação, payload e conclusão. `claim_queue_items` faz claim transacional com `FOR UPDATE SKIP LOCKED`. Jobs abandonados são movidos para `retry` ou `dead_letter` por `recover_stale_queue_items`.

Importações novas gravam diretamente em `lead_batch_members` e `outreach_queue`. O repositório ainda lê `jobs` durante a transição; novos jobs com `leadId` são encaminhados à fila canônica adequada e a API `/queue` consolida as quatro origens sem perder itens legados.

## Segurança

- RLS está habilitado nas tabelas de negócio e restringe o administrador ao próprio `owner_id`.
- Funções de claim e lock são exclusivas de `service_role`.
- O frontend não recebe chaves ou valores secretos; `system_secrets_metadata` guarda somente estado e metadados de rotação.
- Os buckets privados são `materials`, `knowledge`, `message-media` e `temporary`.
- API e worker usam service role somente no servidor.

## Worker local

O processo local registra lock e heartbeat e despacha para sete serviços: `OutreachWorker`, `InboundMessageWorker`, `AIResponseWorker`, `FollowUpWorker`, `MediaWorker`, `AppointmentWorker` e `MaintenanceWorker`.

`OUTREACH_ENABLED=false` e `SIMULATION_MODE=true` são os defaults. Retry técnico usa backoff exponencial com jitter. Antes do envio, uma mensagem comercial é reservada por `idempotency_key`; se a reserva já existir, o reenvio automático é bloqueado e exige revisão manual.

## Aplicação em ambiente real

1. Instale Supabase CLI e Docker.
2. Execute `supabase start`.
3. Execute `supabase db reset` para aplicar todas as migrations e seeds em banco descartável.
4. Crie o administrador via Supabase Auth; migrations de produção não contêm senha.
5. Execute testes RLS com papéis `anon`, `authenticated` e `service_role`.
6. Mantenha outreach desligado até concluir o plano piloto.

Neste ambiente de desenvolvimento, Supabase CLI e Docker não estavam instalados. Por isso o SQL foi validado estaticamente por `pnpm db:validate` e pelos testes; o reset em PostgreSQL real permanece um passo obrigatório antes de produção.
