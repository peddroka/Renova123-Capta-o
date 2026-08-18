# Renova123 Captação

Sistema local de prospecção e atendimento comercial da Renova 123 pelo WhatsApp. O agente único, **Francisco**, importa listas autorizadas, executa abordagens dentro de limites configuráveis, entende respostas com GroqCloud, recomenda materiais permitidos, agenda demonstrações e transfere conversas para atendimento humano.

O envio real nasce **desativado**. Sem credenciais, o fluxo local usa um estado mock persistente e compartilhado entre API e worker; nenhuma mensagem chega ao WhatsApp.

## Início rápido no Windows

Neste computador, a preparação já foi concluída. Para usar agora:

```powershell
.\start.ps1
```

Em uma instalação nova, execute `.\setup.ps1` antes. Para parar ou diagnosticar, use `.\stop.ps1` e `.\doctor.ps1`. O script de início abre API, painel e worker sem depender da política de execução do shim do pnpm.

Abra `http://127.0.0.1:5173`. No desenvolvimento local, o painel abre diretamente e usa uma sessão técnica restrita ao modo mock; não há tela de login.

Leia [START_HERE.md](START_HERE.md) antes de configurar envio real.

## Arquitetura

- `apps/web`: React, TypeScript e Vite; painel responsivo com tema claro/escuro.
- `apps/api`: Fastify; autenticação, webhooks, upload, Groq e Evolution sem segredos no navegador.
- `apps/worker`: filas, respostas prioritárias, follow-ups, materiais, retry/backoff e dead-letter.
- `packages/core`: telefone brasileiro, CSV, agenda e prompts.
- `packages/database`: repositório Supabase e implementação mock.
- `packages/integrations`: SDK oficial TypeScript da Groq e cliente Evolution.
- `packages/shared`: schemas Zod e contratos.
- `packages/ui`: componentes de estado compartilhados.
- `supabase`: migrations, RLS, storage privado e seed.
- `infra/evolution`: Evolution API, PostgreSQL e Redis próprios.

## Qualidade

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm db:validate
pnpm build
pnpm test:e2e
```

O teste E2E requer o painel em execução. O QR real requer Docker, Evolution e credenciais configuradas.

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Ambiente](docs/ENVIRONMENT.md)
- [Evolution](docs/EVOLUTION_SETUP.md)
- [Supabase](docs/SUPABASE_SETUP.md)
- [Groq](docs/GROQ_SETUP.md)
- [Francisco e GroqCloud](docs/GROQ_AGENT.md)
- [Operações](docs/OPERATIONS.md)
- [Segurança](docs/SECURITY.md)
- [Testes](docs/TEST_PLAN.md)
- [Solução de problemas](docs/TROUBLESHOOTING.md)
- [Relatório final](docs/FINAL_REPORT.md)
