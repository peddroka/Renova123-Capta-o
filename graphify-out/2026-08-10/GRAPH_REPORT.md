# Graph Report - Renova123 Captação  (2026-08-10)

## Corpus Check
- 219 files · ~118,573 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1685 nodes · 3077 edges · 149 communities (129 shown, 20 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- worker/src/index.ts
- MockWhatsAppProvider
- shared/src/index.ts
- dependencies
- scripts
- MemoryRepository
- services.ts
- app.ts
- conversation-orchestrator.ts
- AgentContextBuilder
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
- DashboardStats
- supervisor.ts
- shared/package.json
- public.get_dashboard_stats
- whatsapp.ts
- AppointmentsPage.tsx
- compilerOptions
- 20260803000400_persistent_platform.sql
- SupabaseRepository
- dependencies
- Repository
- ../../tsconfig.base.json
- core/package.json
- database/package.json
- group-notifications.ts
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
- outreach-policy.ts
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
- phone.ts
- README.md
- agent-context-builder.ts
- Francisco e GroqCloud
- Decisões de dependências
- Relatório final — 4 de agosto de 2026
- Solução de problemas
- groq.ts
- Persistência, API e worker
- Ambiente e variáveis
- Integração Evolution API
- Evolution API
- Supabase
- Plano de teste
- Evolution API local
- evolution.ts
- api
- Renova123 Captação
- Mapa de reaproveitamento
- AGENTS.md
- public.capture_outreach_template_strategy
- types.ts
- outreach-analytics.ts
- openrouter.ts
- conversation-style.ts
- conversation-memory-service.ts
- opener-policy.ts
- api/src/config.ts
- audit-production-regressions.ts
- knowledge-service.ts
- apply-francisco-conversation-test.mjs
- sales-stage-service.ts
- inspect-evolution-regressions.ts
- ai-decision.ts
- deriveConversationState
- GroqProvider
- structured-output-policy.ts
- qualification-service.ts
- audit-contextual-role-regression.ts
- WhatsAppPage.tsx
- interpretBrazilianContext
- gemini.ts
- EvolutionWhatsAppProvider
- core/src/index.ts
- francisco-commercial-regression.test.ts
- configure-francisco.mjs
- processOutbound
- integrations/src/index.ts
- .qrFrom
- sendOrderedParts

## God Nodes (most connected - your core abstractions)
1. `MemoryRepository` - 38 edges
2. `MockWhatsAppProvider` - 34 edges
3. `SupabaseRepository` - 33 edges
4. `Repository` - 32 edges
5. `EvolutionWhatsAppProvider` - 32 edges
6. `deriveConversationState()` - 27 edges
7. `WhatsAppProvider` - 27 edges
8. `buildApp()` - 26 edges
9. `AgentSnapshot` - 26 edges
10. `AiDecision` - 26 edges

## Surprising Connections (you probably didn't know these)
- `buildApp()` --calls--> `parsePhoneList()`  [EXTRACTED]
  apps/api/src/app.ts → packages/core/src/csv.ts
- `buildApp()` --calls--> `normalizeBrazilianPhone()`  [EXTRACTED]
  apps/api/src/app.ts → packages/core/src/phone.ts
- `buildApp()` --calls--> `createRepository()`  [EXTRACTED]
  apps/api/src/app.ts → packages/database/src/index.ts
- `needsOutboundIdentityRepair()` --calls--> `deriveConversationState()`  [EXTRACTED]
  apps/worker/src/conversation-style.ts → packages/core/src/agent/conversation-state.ts
- `protectConversationContinuity()` --calls--> `deriveConversationState()`  [EXTRACTED]
  apps/worker/src/conversation-style.ts → packages/core/src/agent/conversation-state.ts

## Import Cycles
- None detected.

## Communities (149 total, 20 thin omitted)

### Community 0 - "worker/src/index.ts"
Cohesion: 0.08
Nodes (49): acquireInstanceLock(), applyFollowUpDecision(), auditTokenUsage(), configuredGroq(), conversationKey(), DeferredJobError, ensureLatestInboundProcessing(), executeAgent() (+41 more)

### Community 2 - "shared/src/index.ts"
Cohesion: 0.11
Nodes (18): AgentDecisionValidator, reconcileAction(), safeSlotReply(), validateCommercialClaims(), AppointmentTool, enforceCommercialFactuality(), HandoffTool, facts (+10 more)

### Community 3 - "dependencies"
Cohesion: 0.06
Nodes (33): dependencies, lucide-react, react, react-dom, react-router-dom, @renova123/shared, @renova123/ui, @supabase/supabase-js (+25 more)

### Community 4 - "scripts"
Cohesion: 0.04
Nodes (44): concurrently, eslint, eslint-config-prettier, @eslint/js, devDependencies, concurrently, eslint, eslint-config-prettier (+36 more)

### Community 6 - "services.ts"
Cohesion: 0.24
Nodes (13): AIResponseWorker, AppointmentWorker, DelayedReplyWorker, dispatchJobs(), FollowUpWorker, InboundMessageWorker, JobHandler, MaintenanceWorker (+5 more)

### Community 7 - "app.ts"
Cohesion: 0.12
Nodes (27): buildApp(), creatableResources, createAuthClient(), createServiceClient(), deletableResources, editableResourceKey(), ensureNoAppointmentConflict(), fastify (+19 more)

### Community 8 - "conversation-orchestrator.ts"
Cohesion: 0.19
Nodes (17): ConversationPlan, deduplicateUpdates(), extractDeterministicFacts(), extractLastQuestion(), fold(), inferCurrentTopic(), inferInterest(), memoryAnsweredTopics() (+9 more)

### Community 9 - "AgentContextBuilder"
Cohesion: 0.25
Nodes (4): AgentContextBuilder, headers, main(), rows()

### Community 10 - "index.tsx"
Cohesion: 0.08
Nodes (32): Theme, navigation, Item, KnowledgePage(), Log, LogsPage(), Material, MaterialsPage() (+24 more)

### Community 11 - "PageHeader.tsx"
Cohesion: 0.09
Nodes (20): Feedback(), SkeletonTable(), PageHeader(), NavigationItem, pageMeta, AiStatus, GroqPage(), GroqStatus (+12 more)

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
Cohesion: 0.14
Nodes (13): eligibleProviderOrder(), groqAttemptModels(), isSharedGroqQuotaError(), providerPoolRetrySeconds(), configuredGemini(), configuredOpenRouter(), cooldownRemainingSeconds(), executeAgentWithDailyLimitFallback() (+5 more)

### Community 24 - "supervisor.ts"
Cohesion: 0.13
Nodes (20): evolutionUrl, parsed, repositoryRoot, schema, supabaseUrl, WorkerConfig, canStartWorker(), execFileAsync (+12 more)

### Community 25 - "shared/package.json"
Cohesion: 0.17
Nodes (11): dependencies, zod, exports, zod, name, private, scripts, build (+3 more)

### Community 26 - "public.get_dashboard_stats"
Cohesion: 0.18
Nodes (11): public.ai_response_queue, public.app_settings, public.follow_up_queue, public.outreach_queue, public.suppression_list, public.system_settings, public.get_dashboard_stats(), public.import_lead_batch() (+3 more)

### Community 27 - "whatsapp.ts"
Cohesion: 0.15
Nodes (10): EvolutionConfig, sanitizeWebhookPayload(), config, NormalizedWhatsAppEventType, normalizeWhatsAppText(), WhatsAppConnectionState, WhatsAppContactInput, WhatsAppDownloadedMedia (+2 more)

### Community 28 - "AppointmentsPage.tsx"
Cohesion: 0.29
Nodes (9): Appointment, AppointmentModal(), AppointmentsPage(), dateKey(), label(), local(), monthDays(), statuses (+1 more)

### Community 29 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, allowImportingTsExtensions, jsx, noEmit, types, extends, include, src (+3 more)

### Community 30 - "20260803000400_persistent_platform.sql"
Cohesion: 0.31
Nodes (9): auth, public, public.agent_instructions, public.agent_profiles, public.app_settings, public.knowledge_files, public.knowledge_items, public.system_secrets_metadata (+1 more)

### Community 31 - "SupabaseRepository"
Cohesion: 0.13
Nodes (5): queueJobType(), safeSearch(), SupabaseRepository, toCamelRecord(), toSnakeRecord()

### Community 32 - "dependencies"
Cohesion: 0.07
Nodes (28): dependencies, dotenv, pino, @renova123/core, @renova123/database, @renova123/integrations, @renova123/shared, @supabase/supabase-js (+20 more)

### Community 34 - "../../tsconfig.base.json"
Cohesion: 0.22
Nodes (8): compilerOptions, declaration, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 36 - "core/package.json"
Cohesion: 0.14
Nodes (13): dependencies, @renova123/shared, zod, exports, @renova123/shared, zod, name, private (+5 more)

### Community 37 - "database/package.json"
Cohesion: 0.12
Nodes (15): dependencies, @renova123/core, @renova123/shared, @supabase/supabase-js, exports, @renova123/core, @renova123/shared, @supabase/supabase-js (+7 more)

### Community 38 - "group-notifications.ts"
Cohesion: 0.10
Nodes (36): countUniqueRelevantInboundMessages(), deliverGroupNotification(), enqueueGroupNotification(), humanConversationSummary(), humanDisqualificationReason(), humanMainInterest(), lowerFirst(), markStalledLead() (+28 more)

### Community 39 - "database/src/index.ts"
Cohesion: 0.11
Nodes (15): canonicalQueue(), EditableResourceKey, editableTable, jobPriority(), legacySettingsSections, mockRows, OutreachCapacity, PageResult (+7 more)

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

### Community 54 - "outreach-policy.ts"
Cohesion: 0.22
Nodes (13): assertOperationalTestDestination(), blockJobDuringOperationalTest(), isScopedOnlineTestJob(), jobPhone(), operationalTestModeActive(), processMaterial(), sendMediaSafely(), sendTextSafely() (+5 more)

### Community 55 - ".prettierrc.json"
Cohesion: 0.40
Nodes (4): printWidth, semi, singleQuote, trailingComma

### Community 56 - "validate-migrations.mjs"
Cohesion: 0.50
Nodes (3): directory, files, requiredTables

### Community 57 - "App.tsx"
Cohesion: 0.24
Nodes (11): App(), resourceRoutes, AuthContext, AuthProvider(), AuthState, ProtectedRoute(), useAuth(), AppLayout() (+3 more)

### Community 87 - "phone.ts"
Cohesion: 0.10
Nodes (25): compareOutboundText(), materializeOutreachTemplate(), acceptedHeaders, cleanHeader(), CsvPreviewRow, guessDelimiter(), parsePhoneList(), splitLine() (+17 more)

### Community 88 - "README.md"
Cohesion: 0.15
Nodes (7): Arquitetura, Fluxo, Módulos finais, GroqCloud, Operação, Segurança, Comece aqui

### Community 89 - "agent-context-builder.ts"
Cohesion: 0.16
Nodes (26): clipRecord(), commercialLead(), commercialProvenance(), compactConversation(), compactOlderSummary(), compileMind(), containsOperationalMetadata(), CORE_INSTRUCTION (+18 more)

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

### Community 95 - "groq.ts"
Cohesion: 0.10
Nodes (13): baseSnapshot, enrichQuotaDetails(), GroqCallMetrics, GroqHealth, GroqModel, GroqModelUnavailableError, GroqProviderError, GroqRateLimitError (+5 more)

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

### Community 104 - "evolution.ts"
Cohesion: 0.18
Nodes (16): deliveryStatus(), detectMessageType(), eventTime(), extractQuotedContext(), extractText(), headerValue(), ignoreReason(), IntegrationError (+8 more)

### Community 105 - "api"
Cohesion: 0.26
Nodes (10): api(), ApiError, request(), clear, token, clearAuthSession(), getValidAccessToken(), refreshSession() (+2 more)

### Community 106 - "Renova123 Captação"
Cohesion: 0.40
Nodes (5): Arquitetura, Documentação, Início rápido no Windows, Qualidade, Renova123 Captação

### Community 109 - "public.capture_outreach_template_strategy"
Cohesion: 0.29
Nodes (5): grouped, s.first_inbound_at, public.capture_outreach_template_strategy(), public.conversations, public.leads

### Community 112 - "types.ts"
Cohesion: 0.17
Nodes (12): AgentExecutionService, MaterialRecommendationService, normalize(), AgentCallMetrics, AgentExecutionInput, AgentExecutionResult, AgentMaterial, AgentMessage (+4 more)

### Community 113 - "outreach-analytics.ts"
Cohesion: 0.19
Nodes (8): aggregateOutreachByHour(), localHour(), median(), OUTREACH_ANALYTICS_MIN_SAMPLE, OUTREACH_ANALYTICS_TIMEZONE, OutreachAnalytics, OutreachAnalyticsLead, OutreachHourMetric

### Community 114 - "openrouter.ts"
Cohesion: 0.17
Nodes (12): providerDecisionJsonSchema, assertFreeModel(), estimateTokens(), numericHeader(), OpenRouterCallMetrics, OpenRouterProvider, OpenRouterProviderError, OpenRouterRateLimitError (+4 more)

### Community 116 - "conversation-style.ts"
Cohesion: 0.14
Nodes (29): base, appendLatestLeadMessageIfMissing(), containsBusinessFact(), conversationalBubbleDelayMs(), currentLeadTurn(), ensureActiveInboundReply(), isGreetingOnly(), isIrritatedTurn() (+21 more)

### Community 117 - "conversation-memory-service.ts"
Cohesion: 0.42
Nodes (4): allowed, ConversationMemoryService, evidenceWeight(), AgentMemory

### Community 118 - "opener-policy.ts"
Cohesion: 0.38
Nodes (5): EARLY_PITCH_WORDS, isHumanAttentionOpener(), plain(), ROLE_WORDS, HUMAN_OPENERS

### Community 119 - "api/src/config.ts"
Cohesion: 0.25
Nodes (5): evolutionUrl, parsed, repositoryRoot, schema, supabaseUrl

### Community 120 - "audit-production-regressions.ts"
Cohesion: 0.48
Nodes (6): auditLead(), db, main(), one(), pick(), targets

### Community 122 - "knowledge-service.ts"
Cohesion: 0.60
Nodes (4): keywords(), KnowledgeService, normalize(), scoreText()

### Community 124 - "apply-francisco-conversation-test.mjs"
Cohesion: 0.33
Nodes (6): activeNames, directRequest(), headers, mind, openers, request()

### Community 125 - "sales-stage-service.ts"
Cohesion: 0.50
Nodes (3): SalesStageService, terminal, LeadStage

### Community 126 - "inspect-evolution-regressions.ts"
Cohesion: 0.43
Nodes (6): baseUrl, db, evolution(), main(), records(), textOf()

### Community 127 - "ai-decision.ts"
Cohesion: 0.14
Nodes (17): aiDecisionJsonSchema, AiStructuredOutputError, expandProviderDecision(), extractJsonObject(), JsonSchema, MEMORY_KEYS, parseAiDecision(), providerDecisionSchema (+9 more)

### Community 128 - "deriveConversationState"
Cohesion: 0.25
Nodes (14): commercialMemoryUpdates(), asksAgentIdentity(), contextualSpeechAct(), ConversationState, deriveConversationState(), extractQuestions(), hasExplicitMemory(), isContextualAffirmative() (+6 more)

### Community 129 - "GroqProvider"
Cohesion: 0.22
Nodes (8): callMetrics(), estimateTokens(), GroqProvider, headerValue(), isWhisper(), mockModels(), numberHeader(), retryAfter()

### Community 130 - "structured-output-policy.ts"
Cohesion: 0.70
Nodes (3): STRUCTURED_OUTPUT_MAX_ATTEMPTS, structuredOutputDisposition(), structuredOutputFailurePlan

### Community 131 - "qualification-service.ts"
Cohesion: 0.30
Nodes (12): postHandoffReply(), QualificationService, qualifiedReply(), scheduleFromFacts(), scheduleReply(), addHours(), extractRequestedDemoSchedule(), fold() (+4 more)

### Community 136 - "WhatsAppPage.tsx"
Cohesion: 0.33
Nodes (8): ConnectionState, Diagnostics, formatDate(), formatTime(), labelState(), message(), PairingStatus, WhatsAppPage()

### Community 137 - "interpretBrazilianContext"
Cohesion: 0.29
Nodes (8): ContextualInterpretation, ContextualSpeechAct, fold(), hasSocialOpening(), interpretBrazilianContext(), stripSocialOpening(), withContextualHint(), InterpretationConfidence

### Community 138 - "gemini.ts"
Cohesion: 0.26
Nodes (6): AgentCallMetrics, estimate(), GeminiProvider, GeminiProviderError, GeminiRateLimitError, metrics()

### Community 139 - "EvolutionWhatsAppProvider"
Cohesion: 0.18
Nodes (7): EvolutionWhatsAppProvider, isRecoverable(), recoverableStatus(), sendResult(), sleep(), WhatsAppConnectionStatus, WhatsAppSendResult

### Community 140 - "core/src/index.ts"
Cohesion: 0.40
Nodes (3): buildFranciscoSystemPrompt(), PromptContext, context

### Community 141 - "francisco-commercial-regression.test.ts"
Cohesion: 0.27
Nodes (8): extractExplicitLeadName(), APPROVED_SOCIAL_PROOF, capabilityStatus, CONFIRMED_PRODUCT_CATALOG, enforceProductGrounding(), normalize(), base, facts

### Community 142 - "configure-francisco.mjs"
Cohesion: 0.18
Nodes (7): title(), headers, knowledge, mind, openers, headers, items

### Community 143 - "processOutbound"
Cohesion: 0.24
Nodes (8): nextCommercialSlot(), processOutbound(), reconcileScheduledResume(), evaluateScheduledResume(), ScheduledResumeDecision, ScheduledResumeState, state, canStartOutreach()

### Community 144 - "integrations/src/index.ts"
Cohesion: 0.31
Nodes (5): apps, createRepository(), headers, main(), rows()

### Community 147 - ".qrFrom"
Cohesion: 0.50
Nodes (3): normalizeQr(), numberAt(), WhatsAppQrCode

## Knowledge Gaps
- **489 isolated node(s):** `semi`, `singleQuote`, `trailingComma`, `printWidth`, `name` (+484 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MemoryRepository` connect `MemoryRepository` to `outreach-analytics.ts`, `DashboardStats`, `Repository`, `database/src/index.ts`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `WhatsAppProvider` connect `WhatsAppProvider` to `worker/src/index.ts`, `MockWhatsAppProvider`, `app.ts`, `evolution.ts`, `EvolutionWhatsAppProvider`, `whatsapp.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `PageKey` connect `PageHeader.tsx` to `shared/src/index.ts`, `MemoryRepository`, `database/src/index.ts`, `app.ts`, `ResourcePage.tsx`, `App.tsx`, `SupabaseRepository`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **What connects `semi`, `singleQuote`, `trailingComma` to the rest of the system?**
  _489 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `worker/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07764876632801161 - nodes in this community are weakly interconnected._
- **Should `MockWhatsAppProvider` be split into smaller, more focused modules?**
  _Cohesion score 0.1422924901185771 - nodes in this community are weakly interconnected._
- **Should `shared/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10695187165775401 - nodes in this community are weakly interconnected._