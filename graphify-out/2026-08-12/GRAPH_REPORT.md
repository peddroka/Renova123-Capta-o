# Graph Report - Renova123 Captação  (2026-08-12)

## Corpus Check
- 252 files · ~136,983 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1782 nodes · 3187 edges · 161 communities (140 shown, 21 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 41 edges (avg confidence: 0.64)
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
- deriveConversationState
- processInboundEvent
- index.tsx
- MaterialsPage.tsx
- conversation-orchestrator.ts
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
- phone.ts
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
- gemini.ts
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
- ai-decision.ts
- outreach-analytics.ts
- conversation-memory-service.ts
- core/src/index.ts
- types.ts
- app.py
- interpretBrazilianContext
- audit-production-regressions.ts
- WhatsAppMediaInput
- apply-francisco-conversation-test.mjs
- inspect-evolution-regressions.ts
- GroqProvider
- openrouter.ts
- wolf-transcription/README.md
- audit-contextual-role-regression.ts
- WhatsAppPage.tsx
- runWorker
- EvolutionWhatsAppProvider
- configure-francisco.mjs
- getOwnerId
- AudioNormalizer
- WolfAudioHelper.csproj
- DashboardPage.tsx
- wolf-audio-helper/README.md
- run-wolf-transcription.ts
- wolf-check.ts
- qualification-service.ts
- WolfCaptureProcessor
- PageHeader.tsx
- test-wolf-fixture.ts

## God Nodes (most connected - your core abstractions)
1. `MemoryRepository` - 38 edges
2. `MockWhatsAppProvider` - 34 edges
3. `SupabaseRepository` - 33 edges
4. `Repository` - 32 edges
5. `EvolutionWhatsAppProvider` - 32 edges
6. `buildApp()` - 29 edges
7. `deriveConversationState()` - 27 edges
8. `WhatsAppProvider` - 27 edges
9. `AgentSnapshot` - 26 edges
10. `AiDecision` - 26 edges

## Surprising Connections (you probably didn't know these)
- `buildApp()` --calls--> `parsePhoneList()`  [EXTRACTED]
  apps/api/src/app.ts → packages/core/src/csv.ts
- `buildApp()` --calls--> `normalizeBrazilianPhone()`  [EXTRACTED]
  apps/api/src/app.ts → packages/core/src/phone.ts
- `needsOutboundIdentityRepair()` --calls--> `deriveConversationState()`  [EXTRACTED]
  apps/worker/src/conversation-style.ts → packages/core/src/agent/conversation-state.ts
- `protectConversationContinuity()` --calls--> `deriveConversationState()`  [EXTRACTED]
  apps/worker/src/conversation-style.ts → packages/core/src/agent/conversation-state.ts
- `stripSelfIntroduction()` --calls--> `isSelfIntroduction()`  [EXTRACTED]
  apps/worker/src/conversation-style.ts → packages/core/src/agent/conversation-state.ts

## Import Cycles
- None detected.

## Communities (161 total, 21 thin omitted)

### Community 0 - "worker/src/index.ts"
Cohesion: 0.08
Nodes (46): applyFollowUpDecision(), auditTokenUsage(), configuredGroq(), countUniqueRelevantInboundMessages(), DeferredJobError, deliverGroupNotification(), ensureLatestInboundProcessing(), executeAgent() (+38 more)

### Community 1 - "MockWhatsAppProvider"
Cohesion: 0.12
Nodes (3): EvolutionConfig, MockWhatsAppProvider, WhatsAppContactInput

### Community 2 - "shared/src/index.ts"
Cohesion: 0.08
Nodes (28): AgentDecisionValidator, reconcileAction(), safeSlotReply(), validateCommercialClaims(), AppointmentTool, enforceCommercialFactuality(), extractExplicitLeadName(), HandoffTool (+20 more)

### Community 3 - "dependencies"
Cohesion: 0.06
Nodes (33): dependencies, lucide-react, react, react-dom, react-router-dom, @renova123/shared, @renova123/ui, @supabase/supabase-js (+25 more)

### Community 4 - "scripts"
Cohesion: 0.04
Nodes (46): concurrently, eslint, eslint-config-prettier, @eslint/js, devDependencies, concurrently, eslint, eslint-config-prettier (+38 more)

### Community 6 - "services.ts"
Cohesion: 0.24
Nodes (13): AIResponseWorker, AppointmentWorker, DelayedReplyWorker, dispatchJobs(), FollowUpWorker, InboundMessageWorker, JobHandler, MaintenanceWorker (+5 more)

### Community 7 - "app.ts"
Cohesion: 0.06
Nodes (41): buildApp(), creatableResources, createAuthClient(), createServiceClient(), deletableResources, editableResourceKey(), ensureNoAppointmentConflict(), execFileAsync (+33 more)

### Community 8 - "deriveConversationState"
Cohesion: 0.26
Nodes (14): commercialMemoryUpdates(), asksAgentIdentity(), contextualSpeechAct(), ConversationState, deriveConversationState(), extractQuestions(), hasExplicitMemory(), isContextualAffirmative() (+6 more)

### Community 9 - "processInboundEvent"
Cohesion: 0.24
Nodes (12): assertOperationalTestDestination(), blockJobDuringOperationalTest(), isScopedOnlineTestJob(), jobPhone(), operationalTestModeActive(), presenceState(), processInboundEvent(), CONTROLLED_OUTREACH_TEST_PHONE (+4 more)

### Community 10 - "index.tsx"
Cohesion: 0.13
Nodes (17): Theme, navigation, AppShell(), ConfirmDialog(), DataColumn, Drawer(), FileUploader(), formatBytes() (+9 more)

### Community 11 - "MaterialsPage.tsx"
Cohesion: 0.10
Nodes (22): Feedback(), SkeletonTable(), AiStatus, GroqPage(), GroqStatus, Limits, Model, Item (+14 more)

### Community 12 - "conversation-orchestrator.ts"
Cohesion: 0.20
Nodes (16): ConversationPlan, deduplicateUpdates(), extractDeterministicFacts(), extractLastQuestion(), fold(), inferCurrentTopic(), inferInterest(), memoryAnsweredTopics() (+8 more)

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
Cohesion: 0.04
Nodes (46): dependencies, dotenv, fastify, @fastify/cors, @fastify/helmet, @fastify/multipart, fastify-plugin, @fastify/rate-limit (+38 more)

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
Cohesion: 0.16
Nodes (9): sanitizeWebhookPayload(), config, NormalizedWhatsAppEvent, NormalizedWhatsAppEventType, normalizeWhatsAppText(), WhatsAppConnectionState, WhatsAppDownloadedMedia, WhatsAppMessageKey (+1 more)

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
Cohesion: 0.14
Nodes (26): enqueueGroupNotification(), humanMainInterest(), markStalledLead(), notifySalesQualified(), processQualificationDeadlines(), cleanValue(), disqualifiedMessage(), field() (+18 more)

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

### Community 54 - "phone.ts"
Cohesion: 0.10
Nodes (26): regionFromPhone(), compareOutboundText(), materializeOutreachTemplate(), acceptedHeaders, cleanHeader(), CsvPreviewRow, guessDelimiter(), parsePhoneList() (+18 more)

### Community 55 - ".prettierrc.json"
Cohesion: 0.40
Nodes (4): printWidth, semi, singleQuote, trailingComma

### Community 56 - "validate-migrations.mjs"
Cohesion: 0.50
Nodes (3): directory, files, requiredTables

### Community 57 - "App.tsx"
Cohesion: 0.24
Nodes (11): App(), resourceRoutes, AuthContext, AuthProvider(), AuthState, ProtectedRoute(), useAuth(), AppLayout() (+3 more)

### Community 87 - "gemini.ts"
Cohesion: 0.13
Nodes (12): baseSnapshot, AiStructuredOutputError, AgentCallMetrics, estimate(), GeminiProvider, GeminiProviderError, GeminiRateLimitError, metrics() (+4 more)

### Community 88 - "README.md"
Cohesion: 0.15
Nodes (7): Arquitetura, Fluxo, Módulos finais, GroqCloud, Operação, Segurança, Comece aqui

### Community 89 - "agent-context-builder.ts"
Cohesion: 0.16
Nodes (27): clipRecord(), commercialLead(), commercialProvenance(), compactConversation(), compactOlderSummary(), compileMind(), containsOperationalMetadata(), CORE_INSTRUCTION (+19 more)

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
Cohesion: 0.11
Nodes (13): enrichQuotaDetails(), GroqCallMetrics, GroqHealth, GroqModelUnavailableError, GroqProviderError, GroqRateLimitError, GroqRateLimits, GroqStructuredClient (+5 more)

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
Cohesion: 0.15
Nodes (19): deliveryStatus(), detectMessageType(), eventTime(), extractQuotedContext(), extractText(), headerValue(), ignoreReason(), IntegrationError (+11 more)

### Community 105 - "api"
Cohesion: 0.09
Nodes (25): api(), API_URL, ApiError, rateLimitCooldowns, request(), clear, token, resampleFloat32ToPcm16() (+17 more)

### Community 106 - "Renova123 Captação"
Cohesion: 0.40
Nodes (5): Arquitetura, Documentação, Início rápido no Windows, Qualidade, Renova123 Captação

### Community 109 - "public.capture_outreach_template_strategy"
Cohesion: 0.29
Nodes (5): grouped, s.first_inbound_at, public.capture_outreach_template_strategy(), public.conversations, public.leads

### Community 112 - "ai-decision.ts"
Cohesion: 0.18
Nodes (14): aiDecisionJsonSchema, expandProviderDecision(), extractJsonObject(), JsonSchema, MEMORY_KEYS, parseAiDecision(), providerDecisionSchema, repairCompactDecision() (+6 more)

### Community 113 - "outreach-analytics.ts"
Cohesion: 0.19
Nodes (8): aggregateOutreachByHour(), localHour(), median(), OUTREACH_ANALYTICS_MIN_SAMPLE, OUTREACH_ANALYTICS_TIMEZONE, OutreachAnalytics, OutreachAnalyticsLead, OutreachHourMetric

### Community 114 - "conversation-memory-service.ts"
Cohesion: 0.42
Nodes (4): allowed, ConversationMemoryService, evidenceWeight(), AgentMemory

### Community 116 - "core/src/index.ts"
Cohesion: 0.07
Nodes (43): base, appendLatestLeadMessageIfMissing(), containsBusinessFact(), conversationalBubbleDelayMs(), currentLeadTurn(), ensureActiveInboundReply(), isGreetingOnly(), isIrritatedTurn() (+35 more)

### Community 117 - "types.ts"
Cohesion: 0.11
Nodes (16): AgentContextBuilder, AgentExecutionService, MaterialRecommendationService, normalize(), AgentCallMetrics, AgentExecutionInput, AgentExecutionResult, AgentMaterial (+8 more)

### Community 118 - "app.py"
Cohesion: 0.26
Nodes (11): BaseModel, get, post, audio(), audio_ws(), AudioFrame, health(), process_audio() (+3 more)

### Community 119 - "interpretBrazilianContext"
Cohesion: 0.29
Nodes (8): ContextualInterpretation, ContextualSpeechAct, fold(), hasSocialOpening(), interpretBrazilianContext(), stripSocialOpening(), withContextualHint(), InterpretationConfidence

### Community 120 - "audit-production-regressions.ts"
Cohesion: 0.48
Nodes (6): auditLead(), db, main(), one(), pick(), targets

### Community 122 - "WhatsAppMediaInput"
Cohesion: 0.36
Nodes (3): sendResult(), WhatsAppMediaInput, WhatsAppSendResult

### Community 124 - "apply-francisco-conversation-test.mjs"
Cohesion: 0.33
Nodes (6): activeNames, directRequest(), headers, mind, openers, request()

### Community 126 - "inspect-evolution-regressions.ts"
Cohesion: 0.43
Nodes (6): baseUrl, db, evolution(), main(), records(), textOf()

### Community 128 - "GroqProvider"
Cohesion: 0.28
Nodes (5): callMetrics(), estimateTokens(), GroqProvider, isWhisper(), mockModels()

### Community 129 - "openrouter.ts"
Cohesion: 0.14
Nodes (15): providerDecisionJsonSchema, assertFreeModel(), estimateTokens(), numericHeader(), OpenRouterCallMetrics, OpenRouterProvider, OpenRouterProviderError, OpenRouterRateLimitError (+7 more)

### Community 136 - "WhatsAppPage.tsx"
Cohesion: 0.33
Nodes (8): ConnectionState, Diagnostics, formatDate(), formatTime(), labelState(), message(), PairingStatus, WhatsAppPage()

### Community 138 - "runWorker"
Cohesion: 0.15
Nodes (14): acquireInstanceLock(), conversationKey(), heartbeat(), nextCommercialSlot(), processExists(), processOutbound(), reconcileScheduledResume(), releaseInstanceLock() (+6 more)

### Community 139 - "EvolutionWhatsAppProvider"
Cohesion: 0.24
Nodes (4): EvolutionWhatsAppProvider, normalizeQr(), WhatsAppConnectionStatus, WhatsAppQrCode

### Community 142 - "configure-francisco.mjs"
Cohesion: 0.33
Nodes (4): headers, knowledge, mind, openers

### Community 143 - "getOwnerId"
Cohesion: 0.26
Nodes (10): flagInboundForReview(), getOwnerId(), processSafely(), recordGroqFailure(), recordOutreachFailure(), reportInboundFailure(), retryDelayMs(), STRUCTURED_OUTPUT_MAX_ATTEMPTS (+2 more)

### Community 144 - "AudioNormalizer"
Cohesion: 0.32
Nodes (4): peak, rms, AudioNormalizer, WaveFormat

### Community 147 - "WolfAudioHelper.csproj"
Cohesion: 0.50
Nodes (3): net8.0-windows, NAudio (2.2.1), Microsoft.NET.Sdk

### Community 148 - "DashboardPage.tsx"
Cohesion: 0.12
Nodes (22): Appointment, bestHourLabel(), DashboardData, DashboardPage(), formatDate(), Health, Lead, loadDashboard() (+14 more)

### Community 157 - "run-wolf-transcription.ts"
Cohesion: 0.33
Nodes (5): delay(), python, root, run(), service

### Community 159 - "wolf-check.ts"
Cohesion: 0.67
Nodes (3): checks, main(), portOpen()

### Community 160 - "qualification-service.ts"
Cohesion: 0.19
Nodes (15): postHandoffReply(), QualificationService, qualifiedReply(), scheduleFromFacts(), scheduleReply(), addHours(), extractRequestedDemoSchedule(), fold() (+7 more)

### Community 162 - "PageHeader.tsx"
Cohesion: 0.16
Nodes (10): PageHeader(), WolfIcon(), NavigationItem, pageMeta, ImportPage(), Preview, PreviewRow, PreviewStatus (+2 more)

### Community 168 - "test-wolf-fixture.ts"
Cohesion: 0.40
Nodes (4): dataOffset, pcm, socket, wav

## Knowledge Gaps
- **518 isolated node(s):** `semi`, `singleQuote`, `trailingComma`, `printWidth`, `name` (+513 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Repository` connect `Repository` to `MemoryRepository`, `database/src/index.ts`, `app.ts`, `outreach-analytics.ts`, `DashboardStats`, `SupabaseRepository`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `WhatsAppProvider` connect `WhatsAppProvider` to `worker/src/index.ts`, `MockWhatsAppProvider`, `app.ts`, `evolution.ts`, `EvolutionWhatsAppProvider`, `whatsapp.ts`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `EvolutionWhatsAppProvider` connect `EvolutionWhatsAppProvider` to `worker/src/index.ts`, `MockWhatsAppProvider`, `app.ts`, `evolution.ts`, `WhatsAppProvider`, `WhatsAppMediaInput`, `whatsapp.ts`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `semi`, `singleQuote`, `trailingComma` to the rest of the system?**
  _518 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `worker/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07591836734693877 - nodes in this community are weakly interconnected._
- **Should `MockWhatsAppProvider` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `shared/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0824829931972789 - nodes in this community are weakly interconnected._