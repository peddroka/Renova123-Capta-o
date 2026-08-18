# Arquitetura

Monorepo pnpm em TypeScript estrito: `apps/web` (React/Vite), `apps/api` (Fastify), `apps/worker` (filas) e pacotes `shared`, `core`, `database`, `integrations` e `ui`. O Supabase concentra Auth, PostgreSQL, RLS e Storage privado. Evolution mantém PostgreSQL/Redis próprios. Groq é o único provedor de IA.

## Fluxo

Evolution recebe webhook → API valida, normaliza e deduplica → fila persistente → worker carrega lead, memória e conhecimento → Groq devolve decisão estruturada → validador aplica autorização, takeover, opt-out, limites, horários e idempotência → envio ou simulação → auditoria/notificação.

## Módulos finais

- Materiais: Storage privado, autorização por estágio/intenção, confirmação humana, histórico e arquivamento sem apagar mensagens.
- Conhecimento: texto, FAQ, regras e arquivos; TXT/JSON são extraídos, PDF/PPT ficam para revisão manual; pesquisa textual/tags, sem embeddings.
- Agenda: estados solicitados, vínculo com lead/conversa, origem, reminder, bloqueios, conflito e histórico.
- Takeover: `ai_active`, `human_requested`, `human_active`, `ai_paused`, `returned_to_ai`, `closed`; o worker revalida a pausa antes de toda ação.
- Observabilidade: notificações derivadas da auditoria, health agregado, heartbeat, fila, consumo e logs redigidos.

Migration final: `20260804001000_operational_completion.sql`. Novas tabelas: `material_send_history`, `appointment_history`, `conversation_takeovers`, `notifications`. Endpoints: `/materials`, `/knowledge`, `/appointments`, `/conversations/:leadId/takeover`, `/notifications`, `/health`, `/logs`.
