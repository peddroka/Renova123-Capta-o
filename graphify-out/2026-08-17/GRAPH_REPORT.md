# Graph Report - Renova123 Captação  (2026-08-17)

## Corpus Check
- 289 files · ~196,130 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2165 nodes · 3859 edges · 196 communities (172 shown, 24 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ac06fa4e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- worker/src/index.ts
- MockWhatsAppProvider
- shared/src/index.ts
- dependencies
- scripts
- MemoryRepository
- services.ts
- app.ts
- francisco-preflight.ts
- outreach-analytics.ts
- index.tsx
- groq.ts
- processOutbound
- sendTextOnce
- WhatsAppProvider
- 20260804001000_operational_completion.sql
- compilerOptions
- dependencies
- ResourcePage.tsx
- App.tsx
- integrations/package.json
- 2. Alfred 3.0 2
- api/src/config.ts
- EvolutionWhatsAppProvider
- supervisor.ts
- shared/package.json
- public.get_dashboard_stats
- groupNotificationDedupKey
- deriveConversationState
- compilerOptions
- 20260803000400_persistent_platform.sql
- SupabaseRepository
- dependencies
- manifest.json
- ../../tsconfig.base.json
- core/package.json
- database/package.json
- dev-manager.mjs
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
- group-notifications.ts
- .prettierrc.json
- validate-migrations.mjs
- whatsapp.ts
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
- Repository
- README.md
- agent-context-builder.ts
- Francisco e GroqCloud
- Decisões de dependências
- Relatório final — 4 de agosto de 2026
- Solução de problemas
- structured-output-policy.ts
- Persistência, API e worker
- Ambiente e variáveis
- Integração Evolution API
- Evolution API
- Supabase
- Plano de teste
- Evolution API local
- evolution.ts
- api.ts
- Renova123 Captação
- Mapa de reaproveitamento
- AGENTS.md
- public.capture_outreach_template_strategy
- interpretBrazilianContext
- GroqProvider
- executeAgentWithDailyLimitFallback
- conversation-style.ts
- types.ts
- app.py
- main.ts
- audit-production-regressions.ts
- gemini.ts
- apply-francisco-conversation-test.mjs
- AppointmentsPage.tsx
- inspect-evolution-regressions.ts
- outreach-policy.ts
- openrouter.ts
- conversation-orchestrator.ts
- wolf-transcription/README.md
- audit-contextual-role-regression.ts
- ConversationsPage.tsx
- deterministic_harness.py
- configure-francisco.mjs
- opener-policy.ts
- runWorker
- devDependencies
- AudioNormalizer
- WolfAudioHelper.csproj
- DashboardPage.tsx
- wolf-audio-helper/README.md
- compilerOptions
- run-wolf-transcription.ts
- PageHeader.tsx
- wolf-check.ts
- DashboardStats
- WolfCaptureProcessor
- PageHeader
- ai-decision.ts
- wolf-extension/package.json
- package.json
- WolfRealtimeSession
- test-wolf-fixture.ts
- THE WOLF — Chrome extension
- copy-build.mjs
- AgentSnapshot
- content.js
- support-bundle.mjs
- qa-francisco.ts
- background.js
- normalizeBrazilianPhone
- offscreen.js
- architecture.test.ts
- knowledge-service.ts
- mic-permission.js
- .qrFrom
- conversation-memory-service.ts
- createRepository
- WhatsAppPage.tsx
- prompts.ts
- services
- validate-francisco-providers.ts
- decryptSecret
- expand-francisco-knowledge.mjs

## God Nodes (most connected - your core abstractions)
1. `MemoryRepository` - 40 edges
2. `scripts` - 35 edges
3. `Repository` - 35 edges
4. `SupabaseRepository` - 35 edges
5. `MockWhatsAppProvider` - 34 edges
6. `buildApp()` - 33 edges
7. `EvolutionWhatsAppProvider` - 32 edges
8. `deriveConversationState()` - 27 edges
9. `WhatsAppProvider` - 27 edges
10. `AgentSnapshot` - 26 edges

## Surprising Connections (you probably didn't know these)
- `main()` --indirect_call--> `text()`  [INFERRED]
  scripts/wolf-qwen-check.ts → apps/wolf-extension/public/content.js
- `persistInboundDecision()` --indirect_call--> `item()`  [INFERRED]
  apps/worker/src/index.ts → packages/core/src/agent/knowledge-retrieval.test.ts
- `buildApp()` --calls--> `parsePhoneList()`  [EXTRACTED]
  apps/api/src/app.ts → packages/core/src/csv.ts
- `buildApp()` --calls--> `normalizeBrazilianPhone()`  [EXTRACTED]
  apps/api/src/app.ts → packages/core/src/phone.ts
- `buildApp()` --calls--> `encryptSecret()`  [EXTRACTED]
  apps/api/src/app.ts → packages/core/src/secrets.ts

## Import Cycles
- None detected.

## Communities (196 total, 24 thin omitted)

### Community 0 - "worker/src/index.ts"
Cohesion: 0.07
Nodes (56): applyFollowUpDecision(), auditTokenUsage(), commercialMemoryUpdates(), configuredGroq(), DeferredJobError, deliverGroupNotification(), ensureLatestInboundProcessing(), ensureSalesContactReply() (+48 more)

### Community 2 - "shared/src/index.ts"
Cohesion: 0.08
Nodes (26): baseSnapshot, AgentDecisionValidator, reconcileAction(), safeSlotReply(), validateCommercialClaims(), AppointmentTool, enforceCommercialFactuality(), extractExplicitLeadName() (+18 more)

### Community 3 - "dependencies"
Cohesion: 0.06
Nodes (33): dependencies, lucide-react, react, react-dom, react-router-dom, @renova123/shared, @renova123/ui, @supabase/supabase-js (+25 more)

### Community 4 - "scripts"
Cohesion: 0.06
Nodes (35): scripts, build, db:validate, dev, dev:full, dev:restart, dev:status, dev:stop (+27 more)

### Community 5 - "MemoryRepository"
Cohesion: 0.11
Nodes (3): deadProcess(), MemoryRepository, paginate()

### Community 6 - "services.ts"
Cohesion: 0.24
Nodes (13): AIResponseWorker, AppointmentWorker, DelayedReplyWorker, dispatchJobs(), FollowUpWorker, InboundMessageWorker, JobHandler, MaintenanceWorker (+5 more)

### Community 7 - "app.ts"
Cohesion: 0.10
Nodes (30): buildApp(), buildWolfLiveContext(), creatableResources, createAuthClient(), createServiceClient(), deletableResources, editableResourceKey(), ensureNoAppointmentConflict() (+22 more)

### Community 8 - "francisco-preflight.ts"
Cohesion: 0.23
Nodes (11): add(), Check, checks, getJson(), localMigrations, main(), placeholder(), psql() (+3 more)

### Community 9 - "outreach-analytics.ts"
Cohesion: 0.19
Nodes (8): aggregateOutreachByHour(), localHour(), median(), OUTREACH_ANALYTICS_MIN_SAMPLE, OUTREACH_ANALYTICS_TIMEZONE, OutreachAnalytics, OutreachAnalyticsLead, OutreachHourMetric

### Community 10 - "index.tsx"
Cohesion: 0.08
Nodes (33): format(), Health, HealthPage(), serviceLabel(), Item, KnowledgePage(), Log, LogsPage() (+25 more)

### Community 11 - "groq.ts"
Cohesion: 0.10
Nodes (14): enrichQuotaDetails(), GroqCallMetrics, GroqHealth, GroqModel, GroqModelUnavailableError, GroqProviderError, GroqRateLimitError, GroqRateLimits (+6 more)

### Community 12 - "processOutbound"
Cohesion: 0.14
Nodes (14): nextCommercialSlot(), processOutbound(), reconcileScheduledResume(), compareOutboundText(), materializeOutreachTemplate(), CadenceCandidate, DEFAULT_CADENCE_DELAYS_DAYS, nextCadenceAttempt() (+6 more)

### Community 13 - "sendTextOnce"
Cohesion: 0.47
Nodes (8): deliveryIsUncertain(), deliveryWasAccepted(), markDeliveryAccepted(), markDeliveryUncertain(), markerPath(), directories, writeMarker(), sendTextOnce()

### Community 15 - "20260804001000_operational_completion.sql"
Cohesion: 0.16
Nodes (16): public.appointments, public.materials, public.prevent_appointment_conflict, public.record_appointment_history, appointments_conflict_trigger, appointments_history_trigger, public.appointment_history, public.conversation_takeovers (+8 more)

### Community 16 - "compilerOptions"
Cohesion: 0.11
Nodes (17): DOM.Iterable, compilerOptions, declaration, esModuleInterop, exactOptionalPropertyTypes, isolatedModules, lib, module (+9 more)

### Community 17 - "dependencies"
Cohesion: 0.04
Nodes (46): dependencies, dotenv, fastify, @fastify/cors, @fastify/helmet, @fastify/multipart, fastify-plugin, @fastify/rate-limit (+38 more)

### Community 18 - "ResourcePage.tsx"
Cohesion: 0.16
Nodes (14): configs, Field, formatCell(), friendly(), labels, localDateTime(), PageResult, ResourceConfig (+6 more)

### Community 19 - "App.tsx"
Cohesion: 0.15
Nodes (17): App(), resourceRoutes, AuthContext, AuthProvider(), AuthState, ProtectedRoute(), useAuth(), AppLayout() (+9 more)

### Community 20 - "integrations/package.json"
Cohesion: 0.11
Nodes (17): groq-sdk, dependencies, groq-sdk, @renova123/shared, zod, zod-to-json-schema, exports, @renova123/shared (+9 more)

### Community 21 - "2. Alfred 3.0 2"
Cohesion: 0.08
Nodes (25): 1.1 Stack e ferramentas, 1.2 Estrutura, 1.3 Layout, sidebar e temas, 1.4 Tokens visuais, 1.5 Componentes e comportamento, 1.6 Marca, 1.7 Dependências reaproveitáveis, 1. Renova123 Raio-X da Ótica (+17 more)

### Community 22 - "api/src/config.ts"
Cohesion: 0.22
Nodes (6): config, evolutionUrl, parsed, repositoryRoot, schema, supabaseUrl

### Community 23 - "EvolutionWhatsAppProvider"
Cohesion: 0.18
Nodes (7): EvolutionWhatsAppProvider, isRecoverable(), recoverableStatus(), sendResult(), sleep(), WhatsAppConnectionStatus, WhatsAppSendResult

### Community 24 - "supervisor.ts"
Cohesion: 0.11
Nodes (23): evolutionUrl, parsed, repositoryRoot, schema, supabaseUrl, WorkerConfig, assertWorkerStartupAllowed(), isTrue() (+15 more)

### Community 25 - "shared/package.json"
Cohesion: 0.17
Nodes (11): dependencies, zod, exports, zod, name, private, scripts, build (+3 more)

### Community 26 - "public.get_dashboard_stats"
Cohesion: 0.18
Nodes (11): public.ai_response_queue, public.app_settings, public.follow_up_queue, public.outreach_queue, public.suppression_list, public.system_settings, public.get_dashboard_stats(), public.import_lead_batch() (+3 more)

### Community 27 - "groupNotificationDedupKey"
Cohesion: 0.18
Nodes (16): countUniqueRelevantInboundMessages(), enqueueGroupNotification(), humanConversationSummary(), humanDisqualificationReason(), humanMainInterest(), lowerFirst(), markStalledLead(), notifyDisqualified() (+8 more)

### Community 28 - "deriveConversationState"
Cohesion: 0.28
Nodes (13): asksAgentIdentity(), contextualSpeechAct(), ConversationState, deriveConversationState(), extractQuestions(), hasExplicitMemory(), isContextualAffirmative(), isOwnerOrRoleQuestion() (+5 more)

### Community 29 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, allowImportingTsExtensions, jsx, noEmit, types, extends, include, src (+3 more)

### Community 30 - "20260803000400_persistent_platform.sql"
Cohesion: 0.31
Nodes (9): auth, public, public.agent_instructions, public.agent_profiles, public.app_settings, public.knowledge_files, public.knowledge_items, public.system_secrets_metadata (+1 more)

### Community 31 - "SupabaseRepository"
Cohesion: 0.12
Nodes (5): queueJobType(), safeSearch(), SupabaseRepository, toCamelRecord(), toSnakeRecord()

### Community 32 - "dependencies"
Cohesion: 0.07
Nodes (28): dependencies, dotenv, pino, @renova123/core, @renova123/database, @renova123/integrations, @renova123/shared, @supabase/supabase-js (+20 more)

### Community 33 - "manifest.json"
Cohesion: 0.05
Nodes (36): action, default_icon, default_title, background, service_worker, type, content_scripts, content_security_policy (+28 more)

### Community 34 - "../../tsconfig.base.json"
Cohesion: 0.22
Nodes (8): compilerOptions, declaration, outDir, rootDir, extends, include, src, ../../tsconfig.base.json

### Community 36 - "core/package.json"
Cohesion: 0.14
Nodes (13): dependencies, @renova123/shared, zod, exports, @renova123/shared, zod, name, private (+5 more)

### Community 37 - "database/package.json"
Cohesion: 0.12
Nodes (15): dependencies, @renova123/core, @renova123/shared, @supabase/supabase-js, exports, @renova123/core, @renova123/shared, @supabase/supabase-js (+7 more)

### Community 38 - "dev-manager.mjs"
Cohesion: 0.16
Nodes (21): argsFor, assertRealOutreachOptIn(), checkOccupiedBeforeStart(), getJson(), health(), killTree(), portPid(), ports (+13 more)

### Community 39 - "database/src/index.ts"
Cohesion: 0.11
Nodes (16): canonicalQueue(), EditableResourceKey, editableTable, jobPriority(), legacySettingsSections, mockRows, OutreachCapacity, PageResult (+8 more)

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

### Community 54 - "group-notifications.ts"
Cohesion: 0.16
Nodes (19): cleanValue(), disqualifiedMessage(), field(), format(), formatDisqualifiedGroupMessage(), formatDisqualifiedGroupMessageClean(), formatHumanQualifiedGroupMessage(), formatQualifiedGroupMessage() (+11 more)

### Community 55 - ".prettierrc.json"
Cohesion: 0.40
Nodes (4): printWidth, semi, singleQuote, trailingComma

### Community 56 - "validate-migrations.mjs"
Cohesion: 0.50
Nodes (3): directory, files, requiredTables

### Community 57 - "whatsapp.ts"
Cohesion: 0.15
Nodes (10): EvolutionConfig, sanitizeWebhookPayload(), config, NormalizedWhatsAppEventType, normalizeWhatsAppText(), WhatsAppConnectionState, WhatsAppContactInput, WhatsAppDownloadedMedia (+2 more)

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

### Community 95 - "structured-output-policy.ts"
Cohesion: 0.70
Nodes (3): STRUCTURED_OUTPUT_MAX_ATTEMPTS, structuredOutputDisposition(), structuredOutputFailurePlan

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

### Community 105 - "api.ts"
Cohesion: 0.11
Nodes (23): api(), API_URL, ApiError, rateLimitCooldowns, request(), clear, token, resampleFloat32ToPcm16() (+15 more)

### Community 106 - "Renova123 Captação"
Cohesion: 0.40
Nodes (5): Arquitetura, Documentação, Início rápido no Windows, Qualidade, Renova123 Captação

### Community 109 - "public.capture_outreach_template_strategy"
Cohesion: 0.29
Nodes (5): grouped, s.first_inbound_at, public.capture_outreach_template_strategy(), public.conversations, public.leads

### Community 112 - "interpretBrazilianContext"
Cohesion: 0.29
Nodes (8): ContextualInterpretation, ContextualSpeechAct, fold(), hasSocialOpening(), interpretBrazilianContext(), stripSocialOpening(), withContextualHint(), InterpretationConfidence

### Community 113 - "GroqProvider"
Cohesion: 0.28
Nodes (5): callMetrics(), estimateTokens(), GroqProvider, isWhisper(), mockModels()

### Community 114 - "executeAgentWithDailyLimitFallback"
Cohesion: 0.14
Nodes (13): eligibleProviderOrder(), groqAttemptModels(), isSharedGroqQuotaError(), providerPoolRetrySeconds(), configuredGemini(), configuredOpenRouter(), cooldownRemainingSeconds(), executeAgentWithDailyLimitFallback() (+5 more)

### Community 116 - "conversation-style.ts"
Cohesion: 0.14
Nodes (29): base, appendLatestLeadMessageIfMissing(), containsBusinessFact(), conversationalBubbleDelayMs(), currentLeadTurn(), ensureActiveInboundReply(), isGreetingOnly(), isIrritatedTurn() (+21 more)

### Community 117 - "types.ts"
Cohesion: 0.15
Nodes (14): AgentExecutionService, MaterialRecommendationService, normalize(), AgentExecutionInput, AgentExecutionResult, AgentMaterial, AgentMessage, ContextTokenBreakdown (+6 more)

### Community 118 - "app.py"
Cohesion: 0.21
Nodes (14): BaseModel, get, post, audio(), audio_ws(), AudioFrame, common_prefix(), health() (+6 more)

### Community 119 - "main.ts"
Cohesion: 0.06
Nodes (77): activationMatches(), activationPendingPcm, activationScore(), activeWhatsAppTab(), AiStatus, animateMeters(), api(), BuildInfo (+69 more)

### Community 120 - "audit-production-regressions.ts"
Cohesion: 0.48
Nodes (6): auditLead(), db, main(), one(), pick(), targets

### Community 122 - "gemini.ts"
Cohesion: 0.18
Nodes (10): AiStructuredOutputError, AgentCallMetrics, estimate(), GeminiProvider, GeminiProviderError, GeminiRateLimitError, metrics(), mockDecision() (+2 more)

### Community 124 - "apply-francisco-conversation-test.mjs"
Cohesion: 0.33
Nodes (6): activeNames, directRequest(), headers, mind, openers, request()

### Community 125 - "AppointmentsPage.tsx"
Cohesion: 0.29
Nodes (9): Appointment, AppointmentModal(), AppointmentsPage(), dateKey(), label(), local(), monthDays(), statuses (+1 more)

### Community 126 - "inspect-evolution-regressions.ts"
Cohesion: 0.43
Nodes (6): baseUrl, db, evolution(), main(), records(), textOf()

### Community 128 - "outreach-policy.ts"
Cohesion: 0.33
Nodes (9): assertOperationalTestDestination(), blockJobDuringOperationalTest(), isScopedOnlineTestJob(), jobPhone(), operationalTestModeActive(), CONTROLLED_OUTREACH_TEST_PHONE, isControlledOutreachTestJob(), isOperationalTestMode() (+1 more)

### Community 129 - "openrouter.ts"
Cohesion: 0.16
Nodes (12): providerDecisionJsonSchema, assertFreeModel(), estimateTokens(), numericHeader(), OpenRouterCallMetrics, OpenRouterProvider, OpenRouterProviderError, OpenRouterRateLimitError (+4 more)

### Community 130 - "conversation-orchestrator.ts"
Cohesion: 0.15
Nodes (24): ConversationPlan, deduplicateUpdates(), extractDeterministicFacts(), extractLastQuestion(), fold(), inferCurrentTopic(), inferInterest(), memoryAnsweredTopics() (+16 more)

### Community 136 - "ConversationsPage.tsx"
Cohesion: 0.29
Nodes (9): ConversationsPage(), date(), dateOf(), InboxItem, InboxResult, initials(), Message, MessageResult (+1 more)

### Community 138 - "deterministic_harness.py"
Cohesion: 0.38
Nodes (10): Path, main(), make_fixture(), pcm_metrics(), Deterministic endpointing harness using the production process_audio path. It…, reset_stream(), run_stream(), save_wav() (+2 more)

### Community 139 - "configure-francisco.mjs"
Cohesion: 0.33
Nodes (4): headers, knowledge, mind, openers

### Community 140 - "opener-policy.ts"
Cohesion: 0.38
Nodes (5): EARLY_PITCH_WORDS, isHumanAttentionOpener(), plain(), ROLE_WORDS, HUMAN_OPENERS

### Community 142 - "runWorker"
Cohesion: 0.14
Nodes (11): ConversationLanes, LaneJob, acquireInstanceLock(), conversationKey(), ensureDailyCadencePlan(), heartbeat(), processExists(), recoverStaleJobs() (+3 more)

### Community 143 - "devDependencies"
Cohesion: 0.09
Nodes (23): concurrently, eslint, eslint-config-prettier, @eslint/js, devDependencies, concurrently, eslint, eslint-config-prettier (+15 more)

### Community 144 - "AudioNormalizer"
Cohesion: 0.32
Nodes (4): peak, rms, AudioNormalizer, WaveFormat

### Community 147 - "WolfAudioHelper.csproj"
Cohesion: 0.50
Nodes (3): net8.0-windows, NAudio (2.2.1), Microsoft.NET.Sdk

### Community 148 - "DashboardPage.tsx"
Cohesion: 0.12
Nodes (20): Appointment, bestHourLabel(), DashboardData, DashboardPage(), formatDate(), Health, Lead, loadDashboard() (+12 more)

### Community 156 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, lib, module, moduleResolution, noEmitOnError, outDir, rootDir, strict (+5 more)

### Community 157 - "run-wolf-transcription.ts"
Cohesion: 0.32
Nodes (6): delay(), existingHealthyWhisper(), python, root, run(), service

### Community 158 - "PageHeader.tsx"
Cohesion: 0.31
Nodes (5): WolfIcon(), NavigationItem, pageMeta, PageKey, HeroHeader()

### Community 159 - "wolf-check.ts"
Cohesion: 0.67
Nodes (3): checks, main(), portOpen()

### Community 162 - "PageHeader"
Cohesion: 0.09
Nodes (20): Feedback(), SkeletonTable(), PageHeader(), exitLabels, FlowData, FlowPage(), FlowRow, AiStatus (+12 more)

### Community 163 - "ai-decision.ts"
Cohesion: 0.18
Nodes (14): aiDecisionJsonSchema, expandProviderDecision(), extractJsonObject(), JsonSchema, MEMORY_KEYS, parseAiDecision(), providerDecisionSchema, repairCompactDecision() (+6 more)

### Community 164 - "wolf-extension/package.json"
Cohesion: 0.25
Nodes (7): name, private, scripts, build, typecheck, type, version

### Community 165 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, packageManager, private, version

### Community 166 - "WolfRealtimeSession"
Cohesion: 0.27
Nodes (4): WolfAudioDiagnostic, WolfRealtimeSession, WolfSpeaker, WolfTranscriptEvent

### Community 168 - "test-wolf-fixture.ts"
Cohesion: 0.40
Nodes (4): dataOffset, pcm, socket, wav

### Community 173 - "copy-build.mjs"
Cohesion: 0.22
Nodes (8): dist, hash, manifest, packageJson, required, root, source, timestamp

### Community 174 - "AgentSnapshot"
Cohesion: 0.20
Nodes (9): mergeDecisionMemoryUpdates(), AgentContextBuilder, item(), postHandoffReply(), QualificationService, qualifiedReply(), scheduleFromFacts(), scheduleReply() (+1 more)

### Community 175 - "content.js"
Cohesion: 0.54
Nodes (7): capture(), first(), normalizePhone(), notifyChanged(), scheduleNotify(), text(), visiblePhone()

### Community 176 - "support-bundle.mjs"
Cohesion: 0.33
Nodes (5): files, logDir, out, root, stamp

### Community 178 - "qa-francisco.ts"
Cohesion: 0.19
Nodes (29): child(), cleanup(), commonEnv, dbPath(), delay(), enableTestOutreach(), Event, injectInbound() (+21 more)

### Community 179 - "background.js"
Cohesion: 0.25
Nodes (12): capturedTabs(), captureStartInFlight, debugEvents, debugWrite, emit(), ensureOffscreen(), OFFSCREEN_STATES, resetOffscreenReadiness() (+4 more)

### Community 181 - "normalizeBrazilianPhone"
Cohesion: 0.12
Nodes (22): acceptedHeaders, cleanHeader(), CsvPreviewRow, guessDelimiter(), parsePhoneList(), splitLine(), dddToState, expandScientificNotation() (+14 more)

### Community 182 - "offscreen.js"
Cohesion: 0.39
Nodes (11): analyserRms(), attachClient(), closeClient(), contextInfo(), encodePcm16(), processAudio(), send(), startTab() (+3 more)

### Community 184 - "knowledge-service.ts"
Cohesion: 0.60
Nodes (4): keywords(), KnowledgeService, normalize(), scoreText()

### Community 185 - "mic-permission.js"
Cohesion: 0.50
Nodes (3): button, error, status

### Community 186 - ".qrFrom"
Cohesion: 0.50
Nodes (3): normalizeQr(), numberAt(), WhatsAppQrCode

### Community 187 - "conversation-memory-service.ts"
Cohesion: 0.42
Nodes (4): allowed, ConversationMemoryService, evidenceWeight(), AgentMemory

### Community 188 - "createRepository"
Cohesion: 0.40
Nodes (3): apps, createRepository(), main()

### Community 189 - "WhatsAppPage.tsx"
Cohesion: 0.33
Nodes (8): ConnectionState, Diagnostics, formatDate(), formatTime(), labelState(), message(), PairingStatus, WhatsAppPage()

### Community 190 - "prompts.ts"
Cohesion: 0.50
Nodes (3): buildFranciscoSystemPrompt(), PromptContext, context

### Community 192 - "services"
Cohesion: 0.14
Nodes (13): entrypoint, framework, root, rewrites, services, api, web, wolf-transcription (+5 more)

### Community 193 - "validate-francisco-providers.ts"
Cohesion: 0.67
Nodes (3): headers, main(), rows()

### Community 194 - "decryptSecret"
Cohesion: 0.33
Nodes (5): resolveGroqApiKey(), sanitizeGroqSettings(), decryptSecret(), encryptSecret(), maskSecret()

## Knowledge Gaps
- **656 isolated node(s):** `semi`, `singleQuote`, `trailingComma`, `printWidth`, `name` (+651 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MockWhatsAppProvider` connect `MockWhatsAppProvider` to `worker/src/index.ts`, `app.ts`, `WhatsAppProvider`, `EvolutionWhatsAppProvider`, `whatsapp.ts`, `createRepository`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `Repository` connect `Repository` to `DashboardStats`, `MemoryRepository`, `database/src/index.ts`, `app.ts`, `outreach-analytics.ts`, `qa-francisco.ts`, `PageHeader.tsx`, `SupabaseRepository`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `WhatsAppProvider` connect `WhatsAppProvider` to `worker/src/index.ts`, `MockWhatsAppProvider`, `app.ts`, `evolution.ts`, `EvolutionWhatsAppProvider`, `whatsapp.ts`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `semi`, `singleQuote`, `trailingComma` to the rest of the system?**
  _656 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `worker/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0671602326811211 - nodes in this community are weakly interconnected._
- **Should `MockWhatsAppProvider` be split into smaller, more focused modules?**
  _Cohesion score 0.1422924901185771 - nodes in this community are weakly interconnected._
- **Should `shared/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08326530612244898 - nodes in this community are weakly interconnected._