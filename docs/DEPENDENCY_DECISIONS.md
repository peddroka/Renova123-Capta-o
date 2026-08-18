# Decisões de dependências

## Política

Dependências são adicionadas somente quando reduzem risco ou código significativo. Versões usam ranges controlados e ficam travadas no `pnpm-lock.yaml`. O projeto evita `latest`, bibliotecas de agentes e dependências trazidas apenas por conveniência.

## Decisões principais

| Dependência                  | Decisão | Uso                     | Justificativa                                                      |
| ---------------------------- | ------- | ----------------------- | ------------------------------------------------------------------ |
| pnpm 10.30.3                 | manter  | workspace               | Instalação eficiente, catálogo único e links `workspace:*`         |
| TypeScript 5.9               | manter  | todos                   | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| React 19 + React DOM         | manter  | web/ui                  | Base do painel existente                                           |
| Vite 7                       | manter  | web                     | SPA local rápida; evita carregar Next sem SSR necessário           |
| React Router 7               | manter  | web                     | Rotas do painel sem framework full-stack                           |
| Fastify 5                    | manter  | API                     | HTTP tipado, plugins pequenos, boa performance                     |
| `@fastify/cors`              | manter  | API                     | Origem permitida explícita para web local                          |
| `@fastify/helmet`            | manter  | API                     | Headers defensivos                                                 |
| `@fastify/rate-limit`        | manter  | API                     | Proteção básica de login/webhook/endpoints                         |
| `@fastify/multipart`         | manter  | API                     | Upload/importação e materiais                                      |
| Zod 3                        | manter  | shared/API/worker       | Validação de env, payloads e domínio                               |
| Supabase JS 2                | manter  | web/database/API/worker | Auth no browser e repository backend; service role nunca no web    |
| `groq-sdk`                   | manter  | integrations            | SDK direto pedido pelo usuário; sem camada de agentes              |
| Lucide React                 | manter  | web                     | Ícones acessíveis e consistentes; evita SVG duplicado              |
| Pino / pino-pretty           | manter  | worker/API dev          | Logs estruturados; pretty somente desenvolvimento                  |
| dotenv                       | manter  | API/worker              | Carrega ambiente local; validação final continua no Zod            |
| Vitest                       | manter  | testes                  | Rápido e alinhado a Vite/TypeScript                                |
| Playwright                   | manter  | E2E                     | Valida fluxo desktop/mobile e integração HTTP real                 |
| ESLint 9 + typescript-eslint | manter  | qualidade               | Flat config e regras TypeScript                                    |
| Prettier                     | manter  | formato                 | Formatação determinística e separada do lint                       |
| concurrently                 | manter  | dev                     | Sobe web/API/worker com um comando                                 |

## Dependências deliberadamente não adicionadas

| Dependência/categoria                          | Decisão                   | Motivo                                                                                       |
| ---------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| LangChain / LlamaIndex / frameworks de agentes | não adicionar             | Fluxo é pequeno; SDK Groq e serviços próprios são mais claros e testáveis                    |
| OpenRouter SDK/API                             | não adicionar             | Alfred depende dele por padrão; a Captação usa somente Groq                                  |
| Next.js                                        | não adicionar             | Sem requisito de SSR/Route Handlers; API já é separada                                       |
| Tailwind CSS                                   | não adicionar agora       | CSS atual é pequeno e baseado em tokens; evita toolchain e classes do projeto de origem      |
| Framer Motion                                  | não adicionar agora       | Transições CSS cobrem o painel; animações complexas não são requisito                        |
| Recharts                                       | não adicionar agora       | Não há gráfico que justifique o peso                                                         |
| React Hook Form                                | não adicionar agora       | Formulários atuais são curtos; considerar somente se validação crescer                       |
| QRCode                                         | não adicionar no baseline | Evolution pode devolver data URL/código; UI exibe payload de simulação sem gerador adicional |
| BullMQ                                         | não adicionar agora       | Postgres/jobs + worker atendem o baseline; Redis só entra se métricas provarem necessidade   |
| Prisma/Drizzle                                 | não adicionar agora       | Repository + Supabase JS e SQL explícito evitam segunda abstração                            |
| Axios                                          | não adicionar             | `fetch` nativo cobre HTTP e facilita AbortSignal                                             |
| bibliotecas SaaS do Alfred                     | descartar                 | Cakto, Telegram, Leaflet e módulos sociais estão fora do escopo                              |

## Divergências conscientes das referências

- Raio-X usa npm, Next 14, React 18, Tailwind, Framer Motion e Recharts; o destino preserva apenas identidade e UX.
- Alfred usa npm e várias dependências `latest`; o destino fixa ranges e lockfile.
- Alfred tem Edge Functions sem JWT e acesso REST direto do browser; o destino centraliza mutações sensíveis na API.
- Alfred escolhe OpenRouter por padrão e Groq condicionalmente; o destino usa `groq-sdk` diretamente.
- Alfred mistura fila, IA, Evolution e banco em um helper de 5.558 linhas; o destino separa pacotes e processos.

## Variáveis de ambiente tipadas

`apps/api/src/config.ts` e o worker validam ambiente com Zod. O `.env.example` distingue:

- `VITE_*`: somente URL pública e anon key;
- `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `EVOLUTION_API_KEY`: somente API/worker;
- `MOCK_MODE`, `SIMULATION_MODE`, `REAL_SENDING_ENABLED`: defaults seguros;
- `MOCK_DB_PATH`: persistência local compartilhada entre API e worker.

## Revisão futura

Antes de adicionar uma dependência grande, registrar aqui: problema medido, alternativas consideradas, impacto no bundle/runtime, licença, manutenção e plano de remoção. Imagens Docker também devem ser fixadas por versão ou digest, nunca `latest` em produção.
