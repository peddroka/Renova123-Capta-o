# Auditoria técnica das referências

## Reauditoria do Alfred mais recente — 2026-08-04

O repositório mais novo é `C:\Users\peddroka\Documents\Alfred 3.0 2`, limpo e com último commit `85f3f9e` de 30/07/2026. Foram revisados os 12 commits mais recentes. Melhorias relevantes: instância Evolution já existente deixa de interromper o connect (`02e144a`), erros aninhados/HTML de túnel tornam-se legíveis, compromissos aparecem dentro das células do mês (`e8cdf8f`), integração não configurada deixa de gerar tentativas repetidas (`bb5455b`, `8bb5c3f`) e o painel ganha checklist de conexão (`f2e5ee6`).

Aplicado na Captação: parsing resiliente de respostas Evolution, reaproveitamento seguro de instância existente, calendário mensal com até dois compromissos e contador, bloqueio explícito do botão quando a configuração real está incompleta e checklist do WhatsApp. Não copiado: chave de IA centralizada do SaaS, multi-conta, Telegram, Cakto, OpenRouter e secret de webhook na query string. A Captação mantém Groq exclusiva, uma conta/instância e secret no header, compatível com a Evolution 2.3.6 fixada.

Data: 2026-08-03  
Escopo somente leitura:

- `C:\Users\peddroka\Documents\Renova123 Raio-X da Ótica`
- `C:\Users\peddroka\Documents\Alfred 3.0 2`

Nenhum comando de instalação, formatação, build ou escrita foi executado nas referências. Arquivos `.env.local` não foram abertos. A verificação de integridade usa SHA-256 agregado de caminho + conteúdo, excluindo apenas diretórios gerados (`node_modules`, `.git`, `.next*`, `dist`, `build`, `output`, `tmp`, `coverage` e resultados de teste).

| Referência       | Arquivos auditados | SHA-256 antes                                                      | SHA-256 depois | Resultado |
| ---------------- | -----------------: | ------------------------------------------------------------------ | -------------- | --------- |
| Renova123 Raio-X |                130 | `5D1AC34F2545A8B53677B55661BCD63224317105FA3A5C0B9128904D0608F794` | igual          | intacto   |
| Alfred 3.0 2     |                147 | `625E22F4909FB77039FA6A1A764C6FABCADFE7B6BAB4BE3CD0ACAA3E8690E782` | igual          | intacto   |

O Git do Alfred permaneceu limpo. O Raio-X já estava em um repositório sem commit e com seus arquivos não rastreados; o status permaneceu com o mesmo perfil, e a assinatura de conteúdo comprova que os 130 arquivos auditados não mudaram.

## Resumo executivo

O Raio-X é uma boa referência visual, mas não deve ser copiado como aplicação: ele usa Next.js 14/App Router e npm, enquanto o novo projeto usa React/Vite e pnpm. Logos, favicon e linguagem visual foram copiados; sidebar, tokens, estados e padrões responsivos foram adaptados.

O Alfred contém conhecimento funcional útil sobre Evolution API, filas e conversas, porém é um SaaS multiempresa grande e acoplado. Seu núcleo de backend concentra 5.558 linhas em `_alfred-shared.ts` e o frontend concentra 15.561 linhas em `App.tsx`. A estratégia segura é reimplementar serviços pequenos e testáveis, com Groq direto, uma única conta e migrations novas, sem importar o histórico de 50 migrations.

# 1. Renova123 Raio-X da Ótica

## 1.1 Stack e ferramentas

| Item            | Resultado                                 |
| --------------- | ----------------------------------------- |
| Framework       | Next.js 14.2.35, React 18.3.1, App Router |
| Linguagem       | TypeScript 5.7, `strict: true`            |
| Estilo          | Tailwind CSS 3.4 + `app/globals.css`      |
| Formulários     | React Hook Form + Zod                     |
| Animações       | Framer Motion 11                          |
| Gráficos        | Recharts 3                                |
| Dados           | Supabase JS/SSR                           |
| PDF/e-mail      | React PDF + Resend                        |
| Package manager | npm; `package-lock.json` presente         |
| Build           | Next; não existe `vite.config.*`          |
| Alias           | `@/* -> ./*` no `tsconfig.json`           |

## 1.2 Estrutura

- `app/(public)`: 7 páginas públicas, incluindo `/`, `/raio-x`, `/raio-x/[slug]`, `/raio-x/obrigado`, `/mapa`, `/mapa/[slug]` e `/mapa/resultado`.
- `app/(admin)/admin-r123-x7k2`: dashboard, leads, links, mapa e login.
- `app/api`: 13 Route Handlers para autenticação, leads, links, quiz, relatório e PDF.
- `components`: 15 componentes React.
- `lib`: autenticação, Supabase, cálculos, resultado do quiz e PDF.
- `public`: 8 assets de marca/imagem.
- `supabase/migrations`: 7 migrations específicas do Raio-X.
- `types`: tipos de lead, diagnóstico, link e quiz.

O sistema de rotas é filesystem-based do App Router. Grupos `(public)` e `(admin)` não entram na URL. Segmentos `[slug]` são dinâmicos. Autorização administrativa passa também por `middleware.ts` e cookies de sessão.

## 1.3 Layout, sidebar e temas

`app/layout.tsx` define idioma `pt-BR`, metadata e favicon. Não há fonte web carregada; a renderização usa a pilha sans do navegador/Tailwind (`ui-sans-serif`, fontes de sistema).

`components/AdminSidebar.tsx` é o principal padrão reutilizável:

- desktop somente a partir de `lg` (1024 px);
- 80 px recolhida e 288 px expandida;
- expande em `mouseenter` e recolhe em `mouseleave`;
- conteúdo principal muda de margem para 336 px por seletor irmão;
- ícone compacto troca para logo completa por transição de opacidade;
- item ativo tem fundo branco; inativos usam branco translúcido e `hover:bg-white/24`;
- mobile usa dock inferior arredondado, com safe area e abertura por botão central;
- tema salvo em `localStorage` sob `renova-theme`;
- tema escuro aplica a classe `theme-dark` no elemento `<html>`.

O tema claro usa fundo quase branco, cards brancos, verde e preto. O escuro troca o shell administrativo, cards, bordas, inputs, sidebar e hover de tabelas por variáveis CSS. Ele não é um design system completo: vários seletores dependem de classes Tailwind contendo cores literais, portanto deve ser adaptado, não copiado literalmente.

## 1.4 Tokens visuais

| Token      |     Claro | Escuro quando aplicável |
| ---------- | --------: | ----------------------: |
| background | `#f8faf9` |               `#111513` |
| foreground | `#1a1f1c` |               `#eef5f1` |
| primary    | `#2ecc71` |                 mantido |
| accent     | `#27b966` |                 mantido |
| secondary  | `#ecfdf3` |               `#222a26` |
| muted      | `#6b7280` |               `#a8b5ae` |
| border     | `#e5e7eb` |               `#2c3631` |
| success    | `#1f9f58` |                 mantido |
| danger     | `#f04438` |                 mantido |
| sidebar    | `#2ecc71` |               `#0c0f0d` |

Tailwind usa os breakpoints padrão: `sm` 640, `md` 768, `lg` 1024, `xl` 1280 e `2xl` 1536 px. O CSS global acrescenta regras explícitas em 1024 px e `prefers-reduced-motion`.

## 1.5 Componentes e comportamento

| Categoria      | Implementação observada                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Cards          | raios entre 16 e 32 px, borda suave, sombra curta e áreas de destaque pretas                              |
| Botões         | pill ou 12–16 px de raio; hover por brilho, cor, elevação e escala; estados disabled                      |
| Campos         | inputs nativos estilizados, foco verde, mensagens de erro; React Hook Form em fluxos maiores              |
| Modais         | painéis laterais/backdrops implementados dentro de `AdminGrowthMap`; não há primitive compartilhada       |
| Tabelas        | tabela desktop a partir de `lg`; cards/lista no mobile; linhas com hover                                  |
| Toasts         | não existe biblioteca/sistema global; feedback é inline e `window.confirm` é usado em exclusões           |
| Ícones         | SVGs inline; não há biblioteca de ícones                                                                  |
| Animações      | Framer Motion, keyframes de mesh/gradiente, transições CSS, loaders; respeita reduced motion parcialmente |
| Responsividade | mobile-first, grids `sm/md/lg/xl`, dock inferior e substituição de tabela por lista                       |

Componentes relevantes: `AdminSidebar`, `AdminDashboard`, `AdminChart`, `AdminGrowthMap`, `AdminLinks`, `AdminLoginForm`, `DiagnosticForm`, `TrafficQualificationQuiz`, `TrafficQuizResultView`, `ReportDelivery`, `RelatorioReveal`, `ScrollReveal`, `MotionButtonLink`, `LoginMeshBackground` e `PageShell`.

## 1.6 Marca

Os arquivos de marca adequados para cópia, por pertencerem ao mesmo workspace do usuário, são:

- `public/brand/renova123-compact-icon.png`
- `public/brand/renova123-logo-white.png`
- `public/favicon.ico`
- `public/renova123-logo.png`

`admin-logo-white.png`, `admin-favicon-white.png`, `logo.png` e `marilia-rios.png` são específicos da aplicação anterior e não são necessários.

## 1.7 Dependências reaproveitáveis

- Reutilizar conceito: React, Supabase, Zod.
- Adaptar: tokens CSS, sidebar, responsive lists/tables e estados de feedback.
- Não carregar sem necessidade: Next, Tailwind, Framer Motion, Recharts, React Hook Form, React PDF e Resend.
- O novo web já usa Vite e CSS próprio; adicionar essas bibliotecas apenas quando surgir requisito mensurável.

# 2. Alfred 3.0 2

## 2.1 Stack e estrutura

| Item            | Resultado                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------ |
| Frontend        | React + Vite, TypeScript, CSS global fragmentado                                           |
| Backend         | 15 Supabase Edge Functions em Deno                                                         |
| Banco           | Supabase/Postgres, 50 migrations                                                           |
| Mensageria      | Evolution API v2, WhatsApp/Baileys                                                         |
| Infra           | Docker Compose com Evolution, Postgres 15 e Redis                                          |
| IA              | OpenRouter como rota principal; Groq apenas em política `free_only`/fallback e transcrição |
| Package manager | npm; `package-lock.json` presente                                                          |
| Testes          | script isolado de normalização de telefone; sem suíte geral                                |

`vite.config.ts` usa apenas plugin React, porta 5173 e `allowedHosts: true`. O `package.json` fixa poucas versões e usa `latest` para React, Vite, TypeScript, plugin React e Lucide, prejudicando reprodutibilidade.

## 2.2 Evolution API e Docker

`infra/evolution/docker-compose.yml` sobe:

- `evoapicloud/evolution-api:latest` na porta 8080;
- `postgres:15` com volume persistente;
- `redis:latest` com AOF;
- volume para instâncias do WhatsApp.

Pontos bons: persistência explícita, rede isolada, Redis e exemplos de variáveis. Pontos frágeis: tags `latest`, porta pública por padrão, ausência de healthchecks e nenhuma política de backup. Para o novo projeto, a composição foi adaptada com versões/limites e uso local documentado.

## 2.3 Instância, QR Code e webhook

`supabase/functions/whatsapp-connect/index.ts`:

- autentica o usuário Supabase e resolve a conta;
- gera nome `alfred_<slug>_<id>`;
- chama `POST /instance/create` com `WHATSAPP-BAILEYS`;
- trata instância existente como operação idempotente;
- registra webhook por instância com eventos de mensagem/entrega/conexão/QR;
- chama `/instance/connect` via GET e fallback POST;
- normaliza QR tanto como data URL/base64 quanto como código textual;
- define validade local de 2 minutos e persiste estado em `whatsapp_connections`;
- consulta `/instance/connectionState` para atualização.

Fragilidade: o segredo do webhook também é colocado na query string para compatibilidade. Query strings podem aparecer em logs; no novo projeto o segredo deve ficar em header/assinatura e o endpoint deve aceitar rotação. O helper global ainda tem fallback para `EVOLUTION_INSTANCE`, embora exista modelagem por conta.

## 2.4 Recebimento, envio e mídia

`evolution-webhook/index.ts` exige `EVOLUTION_WEBHOOK_SECRET` e delega tudo a `processEvolutionMessage`.

O processamento:

- ignora grupos e JIDs desconhecidos;
- identifica conta pela instância;
- normaliza telefone brasileiro;
- cria/localiza lead e conversa;
- persiste inbound mesmo com bot pausado;
- agrupa mensagens rápidas por debounce;
- carrega histórico, memória, agenda, materiais e configuração;
- gera resposta, persiste outbound e envia pela Evolution;
- trata `MESSAGES_UPDATE` para `sent`, `delivered`, `read` e `failed`.

Envio de texto usa `/message/sendText/{instance}`. Áudio usa `/message/sendWhatsAppAudio/{instance}`. Vídeo/documento usa `/message/sendMedia/{instance}` com `mediatype`, URL, filename e caption. Recebimento de áudio/vídeo tenta baixar URL/base64 e transcrever por Groq/OpenAI.

Problema: o helper `evolutionResolveWhatsapp` consulta sempre `env.EVOLUTION_INSTANCE`, não a instância resolvida por conta; isto pode validar no tenant errado. Também há envio de follow-up usando a instância global. Nenhuma dessas chamadas multi-conta deve ser copiada.

## 2.5 Telefone e idempotência

`normalizeBrazilPhone` remove caracteres, aceita DDD + 8/9 dígitos e prefixa 55. `phoneVariants` considera versões com/sem nono dígito. A mesma lógica existe novamente em `cakto-webhook`, causando divergência potencial.

Inbound é deduplicado por `messages.external_message_id`, que é `unique` na migration base. Antes de inserir, o código consulta o ID externo. Jobs aceitam atualização de um pending por conversa. Limitação: consulta + inserção não é atômica; a constraint protege duplicação, mas exceções de corrida precisam ser tratadas como sucesso idempotente.

## 2.6 Filas, worker e retry

Não existe processo worker separado. `scheduled-contact-outreach` é uma Edge Function disparada por `pg_cron` a cada 5 minutos e executa, em paralelo:

- `processQueuedAiResponses`;
- `processFollowupJobs`;
- `processContactListOutreach`.

`ai_response_queue` usa estados pending/processing/completed/failed, `available_at`, `locked_at`, attempts e índices parciais. O claim é um PATCH condicionado ao estado. Retry de IA encerra após 3 tentativas e aplica backoff de 15/30/45 segundos, limitado a 120. Um reaper retorna jobs processing há mais de 10 minutos para pending.

Fragilidades:

- aquisição de capacidade e criação de marker não são uma transação; pode exceder paralelismo em corrida;
- configurações e limites são carregados globalmente em alguns caminhos, sem `account_id`;
- follow-ups e outreach misturam claim, regra de negócio, IA, banco e envio em um arquivo único;
- outreach marca falha definitiva no primeiro erro em vários caminhos;
- não há dead-letter queue estruturada nem classificação de erro transitório/permanente;
- cron de 20260627 não enviava `x-alfred-scheduler-secret` e retornava 401 sempre; a migration de 20260712 corrige via Vault, mas mantém URL de projeto hardcoded.

## 2.7 Memória, prompts e geração

Há memória em JSON em lead/conversa e tabelas `agent_memories`/`agent_runs`. O sistema extrai nome, ótica, unidades, dor, estágio, intenção, retorno prometido e contexto de agenda. Prompts vêm de `_pedro-prompt.ts`, `PROMPTS_MENTE_IA_RENOVA123.md`, tabelas `ai_brain_sections` e longos templates dentro de `_alfred-shared.ts`/`pedro-test`.

`_ai-provider.ts` seleciona modelos OpenRouter por padrão. Groq só entra primeiro quando `model_policy === free_only`; caso contrário a lógica depende de `OPENROUTER_API_KEY`. Existem fallbacks entre vários modelos/provedores. Para a Captação, isso foi descartado: `groq-sdk` direto, saída estruturada e serviços pequenos.

## 2.8 Agenda, follow-ups e takeover

`_scheduling.ts` interpreta datas/horas em `America/Sao_Paulo`, calcula slots, evita sobreposição e gera orientação para o prompt. Agendamentos ficam em `appointments` e bloqueios em `appointment_blocks`.

Follow-ups ficam em `followup_jobs`, são cancelados quando chega nova mensagem e podem ser programados por retorno prometido ou fluxo comercial. Takeover é detectado quando chega echo `fromMe` que não coincide com mensagem recente do bot; o código pausa conversa/lead, registra `manual_takeover` e persiste mensagem humana. Opt-out também desliga automação e cancela pendências.

Esses comportamentos são bons requisitos, mas devem ser reimplementados com transações e módulos separados.

## 2.9 Logs, migrations, RLS e Storage

O projeto tem 50 migrations. A base antiga recria várias tabelas em `20260620000001` e `20260620000002`; depois várias migrations alteram RLS, tenancy e constraints. Isso torna uma instalação do zero dependente de ordem e de correções posteriores.

Conflitos/retificações confirmados:

- migrations de 20/06 abriam tabelas inteiras a `anon` com `using(true)`;
- `ai_response_queue` nasceu com SELECT/INSERT/UPDATE anônimo; 12/07 revoga;
- buckets `alfred-materials` e `alfred-contact-lists` nasceram públicos e com upload anônimo; 04/07 os fecha e escopa por conta;
- tenancy foi adicionada depois, por loop dinâmico em tabelas existentes;
- RPCs administrativas concedidas a `anon` foram revogadas em migration posterior;
- cron sem autenticação foi corrigido só em migration posterior;
- alterações de estrutura repetidas usam `if not exists`, ocultando possíveis estados divergentes.

Storage usa buckets de materiais/listas e signed URLs. A configuração final busca escopo por primeira pasta = `account_id`, mas copiar somente a migration final não reproduz com segurança o estado esperado. A Captação deve usar migrations novas, cumulativas e testadas em banco vazio.

`alfred_audit_events` registra login/ações e tem retenção por cron. Logs de runtime são principalmente erros retornados pelas Edge Functions e `last_error` nas filas; faltam correlation ID padronizado, métricas e tracing entre webhook, job, IA e envio.

## 2.10 Segurança e segredos

Auditoria de arquivos versionados encontrou:

- fallback hardcoded de senha master `Lobo123` em `20260704000001_alfred_client_accounts.sql`;
- senha fixa `12345678` para contas de teste em backend, frontend e prompt;
- project ID/URL Supabase hardcoded em `config.toml` e migrations de cron;
- webhook secret aceito por query string;
- 15 Edge Functions com `verify_jwt = false`; algumas têm autenticação própria, o que amplia a superfície para erros de configuração;
- chamadas REST diretas do navegador em `data-service.ts` e `lead-service.ts`, dependentes de RLS perfeita;
- `.env.local` existe, não é versionado e não foi lido. Sua presença não prova vazamento; deve ser rotacionado/auditado pelo responsável antes de produção.

Não foi encontrado valor real de API key nos arquivos rastreados inspecionados. Os placeholders de `infra/evolution/.env.example` são claramente exemplos.

## 2.11 Acoplamento e duplicação

- `_alfred-shared.ts`: 5.558 linhas e responsabilidades de HTTP, Evolution, IA, memória, agenda, pagamentos, contas, filas e CRM.
- `src/App.tsx`: 15.561 linhas.
- CSS repartido em mais de 20 arquivos de correção/override.
- `runtimeEnv`, `envValue`, acesso REST, normalização de telefone e envio Evolution duplicados.
- regras similares entre produção e `pedro-test`, com risco de comportamento diferente.
- configuração global e por conta se misturam.

## 2.12 Funcionalidades SaaS descartadas

Não copiar para a Captação de uma única operação:

- contas/clientes múltiplos, trials, planos e limites comerciais;
- login master e administração de contas;
- Cakto/pagamentos;
- Telegram e abstração multicanal;
- social media, mapa de contas, comissões, vendedores e tarefas de ligação;
- agentes configuráveis genéricos;
- sincronização com outro Supabase Renova123;
- OpenRouter e seleção de vários modelos;
- frontend monolítico do Alfred.

# 3. Conclusão da auditoria

Reaproveitamento autorizado é seletivo: assets e padrões visuais do Raio-X; requisitos e contratos de comportamento do Alfred. Código de negócio do Alfred, migrations antigas, autenticação SaaS e acesso direto do browser foram descartados. O destino já separa `core`, `database`, `integrations`, `ui`, API e worker e mantém mock local sem credenciais.
