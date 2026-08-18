# Graph Report - Renova123 Captação  (2026-08-09)

## Corpus Check
- 184 files · ~99,288 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1479 nodes · 2599 edges · 126 communities (104 shown, 22 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 34 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- worker/src/index.ts
- MockWhatsAppProvider
- agent-decision-validator.ts
- dependencies
- scripts
- MemoryRepository
- services.ts
- app.ts
- group-notifications.ts
- groq.ts
- index.tsx
- PageHeader.tsx
- DashboardPage.tsx
- sendTextOnce
- WhatsAppProvider
- 20260804001000_operational_completion.sql
- compilerOptions
- dependencies
- ResourcePage.tsx
- ConversationsPage.tsx
- integrations/package.json
- 2. Alfred 3.0 2
- executeAgentWithDailyLimitFallback
- structured-output-policy.ts
- worker/src/config.ts
- shared/package.json
- public.get_dashboard_stats
- evolution.ts
- AppointmentsPage.tsx
- compilerOptions
- 20260803000400_persistent_platform.sql
- SupabaseRepository
- dependencies
- core/src/index.ts
- ../../tsconfig.base.json
- toCamelRecord
- core/package.json
- database/package.json
- EvolutionWhatsAppProvider
- database/src/index.ts
- ui/package.json
- worker/tsconfig.json
- ui/tsconfig.json
- Plano de implementação
- core/tsconfig.json
- database/tsconfig.json
- integrations/tsconfig.json
- shared/tsconfig.json
- refine-francisco-strategy.mjs
- 20260803000100_initial_schema.sql
- configure-francisco.mjs
- .prettierrc.json
- validate-migrations.mjs
- App.tsx
- migrations.test.ts
- ensure-local-conversation.mjs
- start-evolution-wsl.sh
- setup-evolution-wsl.sh
- vite.config.ts
- public.audit_logs
- public.knowledge_items
- public.conversations
- public.jobs
- public.messages
- notifyDisqualified
- README.md
- agent-context-builder.ts
- Francisco e GroqCloud
- Decisões de dependências
- Relatório final — 4 de agosto de 2026
- Solução de problemas
- shared/src/index.ts
- Persistência, API e worker
- Ambiente e variáveis
- Integração Evolution API
- Evolution API
- Supabase
- Plano de teste
- Evolution API local
- Repository
- api
- Renova123 Captação
- Mapa de reaproveitamento
- AGENTS.md
- public.capture_outreach_template_strategy
- whatsapp.ts
- DashboardStats
- types.ts
- francisco-commercial-regression.test.ts
- conversation-memory-service.ts
- WhatsAppMediaInput
- sendOrderedParts
- knowledge-service.ts
- apply-francisco-conversation-test.mjs
- opener-policy.ts
- expand-francisco-knowledge.mjs

## God Nodes (most connected - your core abstractions)
1. `MemoryRepository` - 37 edges
2. `MockWhatsAppProvider` - 34 edges
3. `SupabaseRepository` - 32 edges
4. `EvolutionWhatsAppProvider` - 32 edges
5. `Repository` - 31 edges
6. `WhatsAppProvider` - 27 edges
7. `buildApp()` - 25 edges
8. `deriveConversationState()` - 25 edges
9. `api()` - 23 edges
10. `AiDecision` - 21 edges

## Surprising Connections (you probably didn't know these)
- `persistInboundDecision()` --indirect_call--> `item()`  [INFERRED]
  apps/worker/src/index.ts → packages/core/src/agent/knowledge-retrieval.test.ts
- `mergeDecisionMemoryUpdates()` --indirect_call--> `item()`  [INFERRED]
  apps/worker/src/index.ts → packages/core/src/agent/knowledge-retrieval.test.ts
- `processInboundEvent()` --calls--> `isOptOutText()`  [EXTRACTED]
  apps/worker/src/index.ts → packages/core/src/phone.ts
- `processInboundEvent()` --calls--> `normalizeBrazilianPhone()`  [EXTRACTED]
  apps/worker/src/index.ts → packages/core/src/phone.ts
- `processInbound()` --calls--> `withContextualHint()`  [EXTRACTED]
  apps/worker/src/index.ts → packages/core/src/agent/contextual-pt-br.ts

## Import Cycles
- None detected.

## Communities (126 total, 22 thin omitted)

### Community 0 - "worker/src/index.ts"
Cohesion: 0.08
Nodes (46): acquireInstanceLock(), applyFollowUpDecision(), conversationKey(), DeferredJobError, deliverGroupNotification(), flagInboundForReview(), geminiCircuit, getOwnerId() (+38 more)

### Community 2 - "agent-decision-validator.ts"
Cohesion: 0.17
Nodes (12): AgentDecisionValidator, reconcileAction(), safeSlotReply(), validateCommercialClaims(), AppointmentTool, HandoffTool, postHandoffReply(), QualificationService (+4 more)

### Community 3 - "dependencies"
Cohesion: 0.06
Nodes (33): dependencies, lucide-react, react, react-dom, react-router-dom, @renova123/shared, @renova123/ui, @supabase/supabase-js (+25 more)

### Community 4 - "scripts"
Cohesion: 0.05
Nodes (42): concurrently, eslint, eslint-config-prettier, @eslint/js, devDependencies, concurrently, eslint, eslint-config-prettier (+34 more)

### Community 6 - "services.ts"
Cohesion: 0.24
Nodes (13): AIResponseWorker, AppointmentWorker, DelayedReplyWorker, dispatchJobs(), FollowUpWorker, InboundMessageWorker, JobHandler, MaintenanceWorker (+5 more)

### Community 7 - "app.ts"
Cohesion: 0.06
Nodes (48): buildApp(), creatableResources, createAuthClient(), createServiceClient(), deletableResources, editableResourceKey(), ensureNoAppointmentConflict(), fastify (+40 more)

### Community 8 - "group-notifications.ts"
Cohesion: 0.23
Nodes (15): canAttemptGroupDelivery(), cleanValue(), disqualifiedMessage(), field(), format(), formatDisqualifiedGroupMessage(), formatDisqualifiedGroupMessageClean(), formatHumanQualifiedGroupMessage() (+7 more)

### Community 9 - "groq.ts"
Cohesion: 0.06
Nodes (35): baseSnapshot, aiDecisionJsonSchema, AiStructuredOutputError, extractJsonObject(), JsonSchema, parseAiDecision(), repairInvalidAppointment(), repairMechanicalBounds() (+27 more)

### Community 10 - "index.tsx"
Cohesion: 0.08
Nodes (32): Theme, navigation, Item, KnowledgePage(), Log, LogsPage(), Material, MaterialsPage() (+24 more)

### Community 11 - "PageHeader.tsx"
Cohesion: 0.07
Nodes (28): Feedback(), SkeletonTable(), PageHeader(), NavigationItem, pageMeta, AiStatus, GroqPage(), GroqStatus (+20 more)

### Community 12 - "DashboardPage.tsx"
Cohesion: 0.12
Nodes (22): Appointment, bestHourLabel(), DashboardData, DashboardPage(), formatDate(), Health, Lead, loadDashboard() (+14 more)

### Community 13 - "sendTextOnce"
Cohesion: 0.47
Nodes (8): deliveryIsUncertain(), deliveryWasAccepted(), markDeliveryAccepted(), markDeliveryUncertain(), markerPath(), directories, writeMarker(), sendTextOnce()

### Community 15 - "20260804001000_operational_completion.sql"
Cohesion: 0.16
Nodes (16): public.appointments, public.materials, public.prevent_appointment_conflict, public.record_appointment_history, appointments_conflict_trigger, appointments_history_trigger, public.appointment_history, public.conversation_takeovers (+8 more)

### Community 16 - "compilerOptions"
Cohesion: 0.11
Nodes (17): DOM, DOM.Iterable, ES2022, compilerOptions, declaration, esModuleInterop, exactOptionalPropertyTypes, isolatedModules (+9 more)

### Community 17 - "dependencies"
Cohesion: 0.05
Nodes (39): dependencies, dotenv, fastify, @fastify/cors, @fastify/helmet, @fastify/multipart, fastify-plugin, @fastify/rate-limit (+31 more)

### Community 18 - "ResourcePage.tsx"
Cohesion: 0.16
Nodes (14): configs, Field, formatCell(), friendly(), labels, localDateTime(), PageResult, ResourceConfig (+6 more)

### Community 19 - "ConversationsPage.tsx"
Cohesion: 0.16
Nodes (13): Conversation, ConversationsPage(), InboxData, Lead, loadInbox(), Message, PageResult, time() (+5 more)

### Community 20 - "integrations/package.json"
Cohesion: 0.11
Nodes (17): groq-sdk, dependencies, groq-sdk, @renova123/shared, zod, zod-to-json-schema, exports, @renova123/shared (+9 more)

### Community 21 - "2. Alfred 3.0 2"
Cohesion: 0.08
Nodes (25): 1.1 Stack e ferramentas, 1.2 Estrutura, 1.3 Layout, sidebar e temas, 1.4 Tokens visuais, 1.5 Componentes e comportamento, 1.6 Marca, 1.7 Dependências reaproveitáveis, 1. Renova123 Raio-X da Ótica (+17 more)

### Community 22 - "executeAgentWithDailyLimitFallback"
Cohesion: 0.19
Nodes (8): configuredGemini(), configuredGroq(), executeAgent(), executeAgentWithDailyLimitFallback(), persistAgentExecution(), processFollowUp(), CircuitState, ProviderCircuitBreaker

### Community 23 - "structured-output-policy.ts"
Cohesion: 0.70
Nodes (3): STRUCTURED_OUTPUT_MAX_ATTEMPTS, structuredOutputDisposition(), structuredOutputFailurePlan

### Community 24 - "worker/src/config.ts"
Cohesion: 0.22
Nodes (6): evolutionUrl, parsed, repositoryRoot, schema, supabaseUrl, WorkerConfig

### Community 25 - "shared/package.json"
Cohesion: 0.17
Nodes (11): dependencies, zod, exports, zod, name, private, scripts, build (+3 more)

### Community 26 - "public.get_dashboard_stats"
Cohesion: 0.18
Nodes (11): public.ai_response_queue, public.app_settings, public.follow_up_queue, public.outreach_queue, public.suppression_list, public.system_settings, public.get_dashboard_stats(), public.import_lead_batch() (+3 more)

### Community 27 - "evolution.ts"
Cohesion: 0.16
Nodes (19): deliveryStatus(), detectMessageType(), eventTime(), extractQuotedContext(), extractText(), headerValue(), ignoreReason(), IntegrationError (+11 more)

### Community 28 - "AppointmentsPage.tsx"
Cohesion: 0.29
Nodes (9): Appointment, AppointmentModal(), AppointmentsPage(), dateKey(), label(), local(), monthDays(), statuses (+1 more)

### Community 29 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, allowImportingTsExtensions, jsx, noEmit, types, extends, include, src (+3 more)

### Community 30 - "20260803000400_persistent_platform.sql"
Cohesion: 0.31
Nodes (9): auth, public, public.agent_instructions, public.agent_profiles, public.app_settings, public.knowledge_files, public.knowledge_items, public.system_secrets_metadata (+1 more)

### Community 32 - "dependencies"
Cohesion: 0.07
Nodes (26): dependencies, dotenv, pino, @renova123/core, @renova123/database, @renova123/integrations, @renova123/shared, @supabase/supabase-js (+18 more)

### Community 33 - "core/src/index.ts"
Cohesion: 0.06
Nodes (58): base, appendLatestLeadMessageIfMissing(), containsBusinessFact(), currentLeadTurn(), ensureActiveInboundReply(), isIrritatedTurn(), isRestartGreeting(), naturalMessageParts() (+50 more)

### Community 34 - "../../tsconfig.base.json"
Cohesion: 0.22
Nodes (8): compilerOptions, declaration, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 35 - "toCamelRecord"
Cohesion: 0.31
Nodes (3): safeSearch(), toCamelRecord(), toSnakeRecord()

### Community 36 - "core/package.json"
Cohesion: 0.14
Nodes (13): dependencies, @renova123/shared, zod, exports, @renova123/shared, zod, name, private (+5 more)

### Community 37 - "database/package.json"
Cohesion: 0.12
Nodes (15): dependencies, @renova123/core, @renova123/shared, @supabase/supabase-js, exports, @renova123/core, @renova123/shared, @supabase/supabase-js (+7 more)

### Community 38 - "EvolutionWhatsAppProvider"
Cohesion: 0.20
Nodes (5): EvolutionWhatsAppProvider, normalizeQr(), WhatsAppConnectionState, WhatsAppConnectionStatus, WhatsAppQrCode

### Community 39 - "database/src/index.ts"
Cohesion: 0.14
Nodes (12): canonicalQueue(), EditableResourceKey, editableTable, jobPriority(), mockRows, OutreachCapacity, PageResult, pageTable (+4 more)

### Community 40 - "ui/package.json"
Cohesion: 0.12
Nodes (16): dependencies, react, devDependencies, @types/react, exports, ./styles.css, ./tokens.css, react (+8 more)

### Community 41 - "worker/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, declaration, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 42 - "ui/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, jsx, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 44 - "Plano de implementação"
Cohesion: 0.12
Nodes (15): Banco real, Definição de pronto para produção, Evolution real, Fase 0 — auditoria e baseline (concluída), Fase 1 — fundação do monorepo (concluída), Fase 2 — shell visual e navegação (concluída), Fase 3 — núcleo e persistência (concluída para o baseline), Fase 4 — integrações e processamento (concluída para modo mock/simulação) (+7 more)

### Community 46 - "core/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 47 - "database/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 48 - "integrations/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 49 - "shared/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 50 - "refine-francisco-strategy.mjs"
Cohesion: 0.29
Nodes (5): existingOpener, headers, items, mind, opener

### Community 54 - "configure-francisco.mjs"
Cohesion: 0.33
Nodes (4): headers, knowledge, mind, openers

### Community 55 - ".prettierrc.json"
Cohesion: 0.40
Nodes (4): printWidth, semi, singleQuote, trailingComma

### Community 56 - "validate-migrations.mjs"
Cohesion: 0.50
Nodes (3): directory, files, requiredTables

### Community 57 - "App.tsx"
Cohesion: 0.24
Nodes (11): App(), resourceRoutes, AuthContext, AuthProvider(), AuthState, ProtectedRoute(), useAuth(), AppLayout() (+3 more)

### Community 87 - "notifyDisqualified"
Cohesion: 0.19
Nodes (15): countUniqueRelevantInboundMessages(), enqueueGroupNotification(), humanConversationSummary(), humanDisqualificationReason(), humanMainInterest(), lowerFirst(), markStalledLead(), notifyDisqualified() (+7 more)

### Community 88 - "README.md"
Cohesion: 0.15
Nodes (7): Arquitetura, Fluxo, Módulos finais, GroqCloud, Operação, Segurança, Comece aqui

### Community 89 - "agent-context-builder.ts"
Cohesion: 0.17
Nodes (17): AgentContextBuilder, clipRecord(), commercialLead(), commercialProvenance(), configurableMind(), containsOperationalMetadata(), conversationOrigin(), deduplicateKnowledge() (+9 more)

### Community 90 - "Francisco e GroqCloud"
Cohesion: 0.22
Nodes (8): Configuração segura, Decisão de provedor, Decisão estruturada, Fluxo de execução, Francisco e GroqCloud, Opt-out e takeover, Rate limit e falhas, Validação

### Community 92 - "Decisões de dependências"
Cohesion: 0.25
Nodes (7): Decisões de dependências, Decisões principais, Dependências deliberadamente não adicionadas, Divergências conscientes das referências, Política, Revisão futura, Variáveis de ambiente tipadas

### Community 93 - "Relatório final — 4 de agosto de 2026"
Cohesion: 0.25
Nodes (7): Entregue, Estado da entrega, Evidências da validação final, Limitações reais verificadas, Para ativar em produção, Relatório final — 4 de agosto de 2026, Revisão do Alfred atualizado

### Community 94 - "Solução de problemas"
Cohesion: 0.25
Nodes (7): Groq retorna 429, Migration falha, O painel abre, mas não carrega dados, O painel redireciona ou a API retorna 401, QR Code não aparece, Solução de problemas, Webhook retorna 401

### Community 95 - "shared/src/index.ts"
Cohesion: 0.12
Nodes (17): SalesStageService, terminal, aggregateOutreachByHour(), localHour(), median(), OUTREACH_ANALYTICS_MIN_SAMPLE, OUTREACH_ANALYTICS_TIMEZONE, randomIntervalMs() (+9 more)

### Community 96 - "Persistência, API e worker"
Cohesion: 0.29
Nodes (6): Aplicação em ambiente real, Filas, Modelo canônico, Persistência, API e worker, Segurança, Worker local

### Community 98 - "Ambiente e variáveis"
Cohesion: 0.33
Nodes (5): Ambiente e variáveis, Estado de simulação, Exclusivas da API/worker, Portas padrão, Públicas no navegador

### Community 99 - "Integração Evolution API"
Cohesion: 0.33
Nodes (5): Contrato validado, Diagnóstico e operação, Fluxo inbound, Integração Evolution API, Limites de segurança

### Community 100 - "Evolution API"
Cohesion: 0.33
Nodes (5): Evolution API, Iniciar, Preparação, Versão, Webhook

### Community 101 - "Supabase"
Cohesion: 0.40
Nodes (4): Projeto hospedado, Realtime, Segurança, Supabase

### Community 102 - "Plano de teste"
Cohesion: 0.40
Nodes (4): Falhas obrigatórias, Fluxo operacional em simulação, Plano de teste, Validação real

### Community 103 - "Evolution API local"
Cohesion: 0.40
Nodes (4): Atualização segura, Evolution API local, Primeiro uso, Teste real guiado

### Community 105 - "api"
Cohesion: 0.26
Nodes (10): api(), ApiError, request(), clear, token, clearAuthSession(), getValidAccessToken(), refreshSession() (+2 more)

### Community 106 - "Renova123 Captação"
Cohesion: 0.40
Nodes (5): Arquitetura, Documentação, Início rápido no Windows, Qualidade, Renova123 Captação

### Community 109 - "public.capture_outreach_template_strategy"
Cohesion: 0.29
Nodes (5): grouped, s.first_inbound_at, public.capture_outreach_template_strategy(), public.conversations, public.leads

### Community 112 - "whatsapp.ts"
Cohesion: 0.21
Nodes (9): EvolutionConfig, config, NormalizedWhatsAppEvent, NormalizedWhatsAppEventType, normalizeWhatsAppText(), WhatsAppContactInput, WhatsAppDownloadedMedia, WhatsAppMessageKey (+1 more)

### Community 114 - "types.ts"
Cohesion: 0.22
Nodes (9): AgentExecutionService, MaterialRecommendationService, normalize(), AgentCallMetrics, AgentExecutionInput, AgentExecutionResult, AgentMaterial, AgentMessage (+1 more)

### Community 116 - "francisco-commercial-regression.test.ts"
Cohesion: 0.29
Nodes (7): extractExplicitLeadName(), APPROVED_SOCIAL_PROOF, CONFIRMED_PRODUCT_CATALOG, enforceProductGrounding(), normalize(), base, facts

### Community 118 - "conversation-memory-service.ts"
Cohesion: 0.43
Nodes (4): allowed, ConversationMemoryService, evidenceWeight(), AgentMemory

### Community 122 - "knowledge-service.ts"
Cohesion: 0.60
Nodes (4): keywords(), KnowledgeService, normalize(), scoreText()

### Community 124 - "apply-francisco-conversation-test.mjs"
Cohesion: 0.33
Nodes (6): activeNames, directRequest(), headers, mind, openers, request()

### Community 125 - "opener-policy.ts"
Cohesion: 0.38
Nodes (5): EARLY_PITCH_WORDS, isHumanAttentionOpener(), plain(), ROLE_WORDS, HUMAN_OPENERS

## Knowledge Gaps
- **452 isolated node(s):** `semi`, `singleQuote`, `trailingComma`, `printWidth`, `name` (+447 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Repository` connect `Repository` to `MemoryRepository`, `database/src/index.ts`, `app.ts`, `PageHeader.tsx`, `DashboardStats`, `SupabaseRepository`, `shared/src/index.ts`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `EvolutionWhatsAppProvider` connect `EvolutionWhatsAppProvider` to `worker/src/index.ts`, `MockWhatsAppProvider`, `app.ts`, `WhatsAppProvider`, `whatsapp.ts`, `WhatsAppMediaInput`, `evolution.ts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `PageKey` connect `PageHeader.tsx` to `toCamelRecord`, `MemoryRepository`, `database/src/index.ts`, `app.ts`, `ResourcePage.tsx`, `App.tsx`, `shared/src/index.ts`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `semi`, `singleQuote`, `trailingComma` to the rest of the system?**
  _452 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `worker/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08489795918367347 - nodes in this community are weakly interconnected._
- **Should `MockWhatsAppProvider` be split into smaller, more focused modules?**
  _Cohesion score 0.11384615384615385 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._