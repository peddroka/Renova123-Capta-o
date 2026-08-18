import type { AiDecision, LeadStage } from "@renova123/shared";

export type AgentMessage = { role: "lead" | "agent" | "human"; text: string; createdAt?: string; id?: string; externalId?: string };
export type AgentMemory = { key: string; value: string; evidenceType?: "explicit" | "inference" | "hypothesis"; confidence?: number };
export type AgentMaterial = { id: string; name: string; description?: string; category?: string; instruction?: string; active: boolean; allowedStages?: string[]; relatedIntent?: string | null; alreadySent?: boolean };
export type AgentSnapshot = {
  mind: Record<string, unknown>; commercial: Record<string, unknown>; lead: Record<string, unknown>; batch: Record<string, unknown>;
  knowledgeItems?: Array<Record<string, unknown>>;
  stage: LeadStage; summary: string; messages: AgentMessage[]; memories: AgentMemory[]; materials: AgentMaterial[]; availableSlots: string[];
  followUps: Array<Record<string, unknown>>; questionsAsked: string[]; materialsSent: string[]; humanActive: boolean; automationPaused: boolean; blocked: boolean;
  qualificationStatus?: "discovering" | "qualified" | "stalled" | "disqualified"; qualificationScore?: number; handoffType?: string | null; mariliaConsent?: "not_asked" | "pending" | "granted" | "denied";
};
export type ContextTokenBreakdown = { systemTokens: number; instructionTokens: number; mindTokens: number; historyTokens: number; summaryTokens: number; semanticTokens: number; qualificationTokens: number; knowledgeTokens: number; productTokens: number; otherContextTokens: number; currentTurnTokens: number };
export type BuiltAgentContext = { systemPrompt: string; selected: Record<string, unknown>; estimatedTokens: number; summarized: boolean; tokenBreakdown: ContextTokenBreakdown };
export type ProviderAttempt = { provider: string; model: string; latencyMs: number; success: boolean; rateLimited: boolean; reason?: string };
export type AgentCallMetrics = { provider: string; providerPool?: string; model: string; openRouterModel?: string; freeModel?: boolean; usageCost?: number; inputTokens: number; outputTokens: number; totalTokens: number; latencyMs: number; success: boolean; error: string | null; rateLimited: boolean; cachedTokens?: number; cooldownUntil?: string | null; systemTokens?: number; schemaTokens?: number; currentTurnTokens?: number; instructionTokens?: number; mindTokens?: number; historyTokens?: number; summaryTokens?: number; semanticTokens?: number; qualificationTokens?: number; knowledgeTokens?: number; productTokens?: number; otherContextTokens?: number; providerAttempts?: ProviderAttempt[]; regenerationCount?: number; fallbackReason?: string; fallbackCount?: number; timestamp?: string };
export type StructuredAgentProvider = { generateStructuredResponse(input: { systemPrompt: string; userMessage: string; model: string; temperature?: number }): Promise<{ decision: AiDecision; rateLimits: unknown; metrics?: AgentCallMetrics }> };
export type AgentExecutionInput = { snapshot: AgentSnapshot; userMessage: string; model: string; temperature?: number; systemInstructionSuffix?: string };
export type AgentExecutionResult = { rawDecision: AiDecision; decision: AiDecision; rateLimits: unknown; metrics?: AgentCallMetrics; context: BuiltAgentContext; selectedMaterial: AgentMaterial | null; appointmentValid: boolean };
