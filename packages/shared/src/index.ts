import { z } from "zod";

export const leadStages = [
  "imported",
  "new",
  "queued",
  "scheduled",
  "contacting",
  "contacted",
  "awaiting_reply",
  "replied",
  "opening",
  "qualifying",
  "pain_identified",
  "presenting_solution",
  "handling_objection",
  "engaged",
  "interested",
  "demo_requested",
  "demo_scheduling",
  "demo_scheduled",
  "handoff",
  "human_handoff",
  "manual_service",
  "no_response",
  "no_interest",
  "converted",
  "won",
  "lost",
  "opted_out",
  "invalid",
  "blocked",
  "failed",
] as const;

export const intents = [
  "greeting",
  "information",
  "pricing",
  "objection",
  "demo",
  "human",
  "complaint",
  "call_request",
  "multi_store",
  "referral",
  "no_interest",
  "opt_out",
  "unknown",
] as const;

export const aiDecisionSchema = z
  .object({
    replyText: z.string().max(1600).nullable(),
    leadStage: z.enum(leadStages),
    detectedIntent: z.enum(intents),
    sentiment: z.enum(["positive", "neutral", "negative"]),
    summaryUpdate: z.string().max(800).nullable(),
    memoryUpdates: z
      .array(
        z.object({
          key: z.enum([
            "informed_name",
            "store_name",
            "store_count",
            "city",
            "current_system",
            "current_system_type",
            "current_process",
            "main_pain",
            "relevant_secondary_pain",
            "impact",
            "decision_maker",
            "professional_category",
            "interest",
            "interest_signals",
            "irritation_signals",
            "objections",
            "urgency",
            "budget",
            "preferred_tone",
            "current_topic",
            "answered_questions",
            "asked_topics",
            "last_useful_question",
            "sent_materials",
            "availability",
            "demo_status",
            "demo_discussed",
            "demo_accepted",
            "marilia_explained",
            "loss_reason",
            "next_action",
          ]),
          value: z.string().max(1000),
          evidenceType: z.enum(["explicit", "inference", "hypothesis"]),
          confidence: z.number().min(0).max(1),
        }),
      )
      .max(16),
    questionsAnswered: z.array(z.string().max(300)).max(12),
    objectionsDetected: z.array(z.string().max(300)).max(12),
    shouldSendMaterial: z.boolean(),
    materialQuery: z.string().max(300).nullable(),
    shouldProposeDemo: z.boolean(),
    suggestedSlots: z.array(z.string().datetime({ offset: true })).max(8),
    shouldScheduleDemo: z.boolean(),
    appointmentData: z
      .object({
        startsAt: z
          .string()
          .datetime({ offset: true })
          .describe("Data/hora ISO 8601 completa com fuso, nunca texto relativo."),
        endsAt: z
          .string()
          .datetime({ offset: true })
          .describe("Data/hora ISO 8601 completa com fuso, nunca texto relativo."),
        notes: z.string().max(1000),
      })
      .nullable(),
    shouldHandoff: z.boolean(),
    handoffReason: z.string().max(500).nullable(),
    shouldOptOut: z.boolean(),
    followUpAction: z.object({
      action: z.enum(["schedule", "cancel", "none"]),
      delayHours: z.number().int().min(1).max(720).nullable(),
      reason: z.string().max(500),
    }),
    confidence: z.number().min(0).max(1),
    internalReasoningSummary: z.string().max(500).describe("Resumo operacional breve, sem chain-of-thought."),
    qualificationStatus: z.enum(["discovering", "qualified", "stalled", "disqualified"]),
    handoffType: z
      .enum(["sales_qualified", "human_requested", "low_confidence", "technical", "pricing", "other"])
      .nullable(),
    qualificationScore: z.number().min(0).max(100),
    mariliaConsent: z.enum(["not_asked", "pending", "granted", "denied"]),
    // Compact semantic signals are additive; legacy fields remain for persisted jobs and providers.
    conversationSignals: z
      .object({
        permissionToContinue: z.boolean().optional(),
        commercialInterest: z.enum(["low", "medium", "high"]).optional(),
        productCuriosity: z.boolean().optional(),
        demoInterest: z.boolean().optional(),
        demoConsent: z.boolean().optional(),
        handoffConsent: z.boolean().optional(),
        irritation: z.boolean().optional(),
        humor: z.boolean().optional(),
        directQuestion: z.string().max(300).nullable().optional(),
        currentTopic: z.string().max(120).nullable().optional(),
      })
      .optional(),
    action: z
      .enum([
        "continue_discovery",
        "explain_product",
        "answer_question",
        "create_curiosity",
        "offer_demo",
        "confirm_demo",
        "handoff",
        "close_disinterest",
      ])
      .optional(),
  })
  .strict();

export type AiDecision = z.infer<typeof aiDecisionSchema>;
export type LeadStage = (typeof leadStages)[number];

export const importBatchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  source: z.string().trim().min(2).max(200),
  context: z.string().trim().min(2).max(4000),
  notes: z.string().max(4000).default(""),
  initialStrategy: z.string().max(4000).default(""),
  authorized: z.literal(true),
  priority: z.number().int().min(1).max(10).default(5),
  startDate: z.string(),
  dailyLimit: z.number().int().positive().max(10000).nullable().default(null),
});

export const outreachSettingsSchema = z
  .object({
    dailyLimit: z.number().int().min(1).max(10000),
    hourlyLimit: z.number().int().min(1).max(1000),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    minIntervalSeconds: z.number().int().min(5),
    maxIntervalSeconds: z.number().int().min(5),
    minIntervalMinutes: z.number().int().min(1).max(180).default(7),
    maxIntervalMinutes: z.number().int().min(1).max(180).default(16),
    proactiveHardFloorMinutes: z.number().int().min(6).max(180).default(6),
    proactiveJitterMinMinutes: z.number().int().min(1).max(60).default(1),
    proactiveJitterMaxMinutes: z.number().int().min(1).max(60).default(10),
    timezone: z.string().min(1),
    campaignStartAt: z.string().datetime({ offset: true }).optional(),
    enabled: z.boolean().optional(),
    maxConsecutiveFailures: z.number().int().min(1).max(100),
    autoPause: z.boolean(),
    followUpsEnabled: z.boolean(),
    maxFollowUps: z.number().int().min(0).max(20),
    followUpIntervalHours: z.number().int().min(1).max(720),
    batchPriority: z.enum(["priority", "oldest", "round_robin"]),
    dailyProactiveLimit: z.number().int().positive().max(10000).default(50),
    newLeadsDailyLimit: z.number().int().min(1).max(500).optional(),
    stageDailyLimits: z
      .array(z.number().int().min(1).max(500))
      .length(6)
      .optional(),
    cadenceDelaysDays: z.array(z.number().int().min(0).max(365)).length(6).default([0, 1, 2, 4, 8, 16]),
  })
  .superRefine((value, context) => {
    if (value.startTime >= value.endTime)
      context.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "O horário final deve ser posterior ao inicial.",
      });
    if (value.minIntervalSeconds > value.maxIntervalSeconds)
      context.addIssue({
        code: "custom",
        path: ["maxIntervalSeconds"],
        message: "O intervalo máximo deve ser maior ou igual ao mínimo.",
      });
    if (value.minIntervalMinutes > value.maxIntervalMinutes)
      context.addIssue({
        code: "custom",
        path: ["maxIntervalMinutes"],
        message: "O intervalo máximo em minutos deve ser maior ou igual ao mínimo.",
      });
    if (value.proactiveJitterMinMinutes > value.proactiveJitterMaxMinutes)
      context.addIssue({
        code: "custom",
        path: ["proactiveJitterMaxMinutes"],
        message: "O jitter máximo deve ser maior ou igual ao jitter mínimo.",
      });
  });

export type OutreachSettings = z.infer<typeof outreachSettingsSchema>;

export type PageKey =
  | "overview"
  | "calls"
  | "flow"
  | "leads"
  | "imports"
  | "batches"
  | "queue"
  | "conversations"
  | "interested"
  | "qualified"
  | "demos"
  | "unanswered"
  | "followups"
  | "handoffs"
  | "lost"
  | "optouts"
  | "materials"
  | "knowledge"
  | "notifications"
  | "mind"
  | "openers"
  | "schedule"
  | "groq"
  | "whatsapp"
  | "health"
  | "logs"
  | "settings";

export interface DashboardStats {
  totalLeads: number;
  contactedToday: number;
  activeConversations: number;
  interested: number;
  scheduledDemos: number;
  handoffs: number;
  optOuts: number;
  queuePending: number;
  dailyLimit: number;
  simulationMode: boolean;
  newLeadsDailyLimit?: number;
  pendingTasks?: number;
  pendingUniqueLeads?: number;
  sendMode?: "MOCK / BLOQUEADO" | "REAL / PAUSADO" | "REAL / ATIVO" | "ERRO";
  sendModeReason?: string;
}

export type OutreachAnalyticsLead = {
  initialOutreachSentAt?: string | null;
  firstInboundAt?: string | null;
  qualifiedAt?: string | null;
  stalledAt?: string | null;
};

export type OutreachHourMetric = {
  hour: number;
  label: string;
  sent: number;
  responded: number;
  responseRate: number;
  qualified: number;
  qualificationRate: number;
  medianMinutesToFirstResponse: number | null;
};

export type OutreachAnalytics = {
  timezone: string;
  hours: OutreachHourMetric[];
  bestResponseHour: number | null;
  bestQualificationHour: number | null;
  minimumSampleSize: number;
  totalSample: number;
};

export interface LeadSummary {
  id: string;
  batchId?: string | null;
  phone: string;
  name: string | null;
  company: string | null;
  stage: LeadStage;
  source: string;
  lastContactAt: string | null;
  createdAt: string;
}
