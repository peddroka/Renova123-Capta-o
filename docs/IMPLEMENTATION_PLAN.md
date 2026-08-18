# Plano de implementação

Este documento registra o plano decorrente da auditoria e o estado observado em 2026-08-03.

## Princípios

- uma operação Renova123, sem multi-tenant SaaS;
- Vite no web, Fastify na API e processo Node dedicado no worker;
- Groq SDK direto, sem LangChain e sem OpenRouter;
- segredos somente em API/worker;
- migrations próprias, cumulativas e testáveis em banco vazio;
- modo mock persistente para desenvolvimento sem credenciais;
- integração Evolution encapsulada e envio real desligado por padrão.

## Fase 0 — auditoria e baseline (concluída)

- [x] Inspecionar stack, rotas, UI, temas, assets e dependências do Raio-X.
- [x] Inspecionar Evolution, IA, filas, agenda, takeover, migrations, RLS e Storage do Alfred.
- [x] Registrar riscos de cron, senhas, RLS anônima, multi-conta e acoplamento.
- [x] Definir mapa copiar/adaptar/reimplementar/descartar.
- [x] Registrar assinatura read-only das duas referências.

## Fase 1 — fundação do monorepo (concluída)

- [x] Inicializar Git em `Renova123 Captação`.
- [x] Criar pnpm workspace para `apps/*` e `packages/*`.
- [x] Criar `apps/web`, `apps/api`, `apps/worker`.
- [x] Criar `packages/shared`, `packages/core`, `packages/database`, `packages/integrations`, `packages/ui`.
- [x] Configurar TypeScript strict, aliases por workspace, ESLint flat config, Prettier e Vitest.
- [x] Criar `.env.example`, scripts PowerShell e documentação operacional.
- [x] Instalar e travar dependências em `pnpm-lock.yaml`.

## Fase 2 — shell visual e navegação (concluída)

- [x] Copiar quatro assets oficiais.
- [x] Adaptar tokens claro/escuro e persistência do tema.
- [x] Implementar sidebar expansível, navegação mobile e layout responsivo.
- [x] Implementar login mock, dashboard, páginas de recursos e feedback.
- [x] Implementar CRUD real no modo mock e integração API.

## Fase 3 — núcleo e persistência (concluída para o baseline)

- [x] Modelar schemas compartilhados com Zod.
- [x] Centralizar telefone, CSV, opt-out, horários e prompt.
- [x] Implementar repository mock persistente e repository Supabase.
- [x] Criar migrations novas com owner scope, RLS e funções seguras.
- [x] Implementar importação com deduplicação e criação de jobs.
- [x] Implementar auditoria e endpoints de recursos.

## Fase 4 — integrações e processamento (concluída para modo mock/simulação)

- [x] Cliente Evolution para instância, status, QR, webhook, texto e mídia.
- [x] Provider Groq estruturado com mock; 429 retorna o job à fila conforme `Retry-After`, sem retry interno nem troca de provedor.
- [x] Webhook de inbound/status na API.
- [x] Worker para outreach, inbound reply, follow-up e controles de capacidade.
- [x] Takeover, opt-out, agenda, follow-up e debounce persistentes.
- [x] Worker inicia sem credenciais com `MOCK_MODE=true`.

## Fase 5 — validação local (concluída nesta etapa)

- [x] Workspaces reconhecidos pelo pnpm.
- [x] Lint sem warnings.
- [x] TypeScript compila em todos os workspaces.
- [x] Testes unitários/integração executados.
- [x] Migrations validadas em ordem.
- [x] Build web/API/worker executado.
- [x] Web respondeu HTTP.
- [x] API respondeu `/health`.
- [x] Worker iniciou em modo mock sem credenciais.
- [x] Assinaturas das referências conferidas novamente.

## Próximas fases antes de produção

### Banco real

1. Subir Supabase separado para a Captação.
2. Aplicar todas as migrations versionadas em banco vazio e executar smoke test RLS com anon/authenticated/service role.
3. Criar usuário admin real e remover qualquer seed de credencial previsível.
4. Configurar bucket privado de materiais e política por owner.

### Evolution real

1. Fixar versão compatível da imagem Evolution e habilitar healthcheck/backup.
2. Configurar HTTPS, API key e webhook secret rotacionáveis.
3. Validar create/connect/QR/status em instância descartável.
4. Validar texto, mídia e callbacks `MESSAGES_UPSERT`/`MESSAGES_UPDATE`.
5. Manter `REAL_SENDING_ENABLED=false` até aprovação manual do lote piloto.

### Groq real

1. Configurar `GROQ_API_KEY` apenas no backend.
2. Executar conjunto de conversas de regressão e validar schema estruturado.
3. Definir limites, timeouts, métricas de custo/latência e fallback controlado sem outro provedor implícito.

### Operação piloto

1. Importar lista pequena e consentida.
2. Conferir supressão, limites diário/hora/lote e horários de contato.
3. Acompanhar delivery, retry, handoff e follow-up.
4. Registrar rollback: desligar envio real, pausar worker e preservar jobs.

## Definição de pronto para produção

- testes RLS automatizados em banco real;
- nenhum segredo em frontend, log ou query string;
- imagens Docker fixadas por versão/digest;
- backup/restauração testados;
- métricas de fila, idade do job, erros Evolution/Groq e taxa de opt-out;
- consentimento, origem da lista e política de retenção aprovados;
- runbook de incidente e kill switch testados.

## Registro de execução desta etapa

Ambiente: Node `v24.17.0`, pnpm `10.30.3`, Windows/PowerShell.

| Comando/probe                                           | Resultado                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                        | lockfile atual; dependências já instaladas                                                   |
| `pnpm -r list --depth -1`                               | 9 projetos: raiz + 3 apps + 5 packages                                                       |
| `pnpm lint`                                             | sucesso, zero warnings                                                                       |
| `pnpm typecheck`                                        | sucesso nos 8 workspaces executáveis                                                         |
| `pnpm test`                                             | 3 arquivos, 11 testes aprovados                                                              |
| `pnpm test:e2e`                                         | 6 cenários aprovados em Chromium desktop/mobile                                              |
| `pnpm db:validate`                                      | 7 migrations em ordem, incluindo filas canônicas, RLS, Storage e compatibilidade             |
| `pnpm build`                                            | sucesso em web, API, worker e packages; web 301,30 kB JS bruto / 95,31 kB gzip               |
| `GET http://127.0.0.1:5173/`                            | HTTP 200, `text/html`                                                                        |
| `GET http://127.0.0.1:3333/health`                      | HTTP 200, modo `mock`, simulação ativa                                                       |
| `node apps/worker/dist/index.js` com credenciais vazias | permaneceu ativo; log `worker_started`, `mock:true`, `simulation:true`; encerrado após probe |
| Prettier nos quatro documentos                          | sucesso                                                                                      |

O primeiro probe do worker compilado expôs que os packages apontavam `exports` para `src/*.ts`. Isso permitia desenvolvimento via tsx, mas quebrava o runtime Node compilado. Os cinco packages agora expõem `types`/`development` a partir de `src` e `default` a partir de `dist`; API/worker dev usam a condição `development`. Build, lint, typecheck e o probe compilado foram repetidos depois da correção.

Integridade das referências após todos os comandos:

- Raio-X: 130 arquivos, SHA-256 agregado `5D1AC34F2545A8B53677B55661BCD63224317105FA3A5C0B9128904D0608F794`, idêntico ao inicial.
- Alfred: 147 arquivos, SHA-256 agregado `625E22F4909FB77039FA6A1A764C6FABCADFE7B6BAB4BE3CD0ACAA3E8690E782`, idêntico ao inicial.
