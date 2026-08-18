import { aiDecisionSchema, type AiDecision } from "@renova123/shared";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

type JsonSchema = Record<string, unknown>;

export const aiDecisionJsonSchema = closeObjects(
  zodToJsonSchema(aiDecisionSchema, { $refStrategy: "none", target: "jsonSchema7" }) as JsonSchema,
) as JsonSchema;
delete aiDecisionJsonSchema.$schema;

const providerDecisionSchema = z.object({
  reply: z.string().max(1_600).nullable(),
  intent: z.enum(["greeting", "information", "pricing", "objection", "demo", "human", "complaint", "call_request", "multi_store", "referral", "no_interest", "opt_out", "unknown"]),
  memories: z.array(z.object({ key: z.string().max(50), value: z.string().max(500), evidence: z.enum(["explicit", "inference", "hypothesis"]), confidence: z.number().min(0).max(1) })).max(10),
  action: z.enum(["continue_discovery", "explain_product", "answer_question", "create_curiosity", "offer_demo", "confirm_demo", "handoff", "close_disinterest"]),
  material: z.string().max(200).nullable(),
  appointment: z.object({ startsAt: z.string().max(50), endsAt: z.string().max(50), notes: z.string().max(300) }).nullable(),
  handoff: z.enum(["sales_qualified", "human_requested", "low_confidence", "technical", "pricing", "other"]).nullable(),
  consent: z.enum(["not_asked", "pending", "granted", "denied"]),
  confidence: z.number().min(0).max(1),
}).strict();

export const providerDecisionJsonSchema = closeObjects(
  zodToJsonSchema(providerDecisionSchema, { $refStrategy: "none", target: "jsonSchema7" }) as JsonSchema,
) as JsonSchema;
delete providerDecisionJsonSchema.$schema;

export class AiStructuredOutputError extends Error {
  readonly recoverable = true;
  constructor(
    public readonly provider: "groq" | "gemini" | "openrouter",
    message: string,
    public readonly rawOutput: string | null = null,
  ) {
    super(`${provider}: ${message}`);
    this.name = "AiStructuredOutputError";
  }
}

export function parseAiDecision(provider: "groq" | "gemini" | "openrouter", text: string, userMessage = ""): AiDecision {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(text));
  } catch {
    throw new AiStructuredOutputError(provider, "resposta não é um objeto JSON válido.", text.slice(0, 4_000));
  }
  value = repairMechanicalBounds(repairInvalidAppointment(value));
  const result = aiDecisionSchema.safeParse(value);
  if (result.success) return result.data;
  const compact = providerDecisionSchema.safeParse(repairCompactDecision(value));
  if (compact.success) return expandProviderDecision(compact.data, userMessage);
  const issues = compact.error.issues.map((issue) => `${issue.path.join(".") || "decisão"}: ${issue.message}`).join("; ");
  throw new AiStructuredOutputError(provider, `resposta incompatível com a decisão compacta (${issues}).`, text.slice(0, 4_000));
}

const MEMORY_KEYS = new Set(["informed_name", "store_name", "store_count", "city", "current_system", "current_system_type", "current_process", "main_pain", "relevant_secondary_pain", "impact", "decision_maker", "professional_category", "interest", "interest_signals", "irritation_signals", "objections", "urgency", "budget", "preferred_tone", "current_topic", "answered_questions", "asked_topics", "last_useful_question", "sent_materials", "availability", "demo_status", "demo_discussed", "demo_accepted", "marilia_explained", "loss_reason", "next_action"]);

function expandProviderDecision(value: z.infer<typeof providerDecisionSchema>, userMessage: string): AiDecision {
  const terminal = value.intent === "opt_out" || value.intent === "no_interest" || value.action === "handoff";
  const appointment = validAppointment(value.appointment) ? value.appointment : null;
  const proposeDemo = value.action === "offer_demo" || value.action === "confirm_demo";
  const shouldHandoff = value.action === "handoff" || value.handoff !== null;
  const shouldOptOut = value.intent === "opt_out";
  const stage = value.intent === "opt_out" ? "opted_out"
    : value.intent === "no_interest" || value.action === "close_disinterest" ? "no_interest"
    : shouldHandoff ? "handoff"
    : value.action === "confirm_demo" ? "demo_scheduling"
    : value.action === "offer_demo" || value.intent === "demo" ? "demo_requested"
    : value.intent === "objection" ? "handling_objection"
    : ["pricing", "multi_store", "referral"].includes(value.intent) ? "interested"
    : "engaged";
  const sentiment = value.intent === "greeting" ? "positive" : ["objection", "complaint", "no_interest", "opt_out"].includes(value.intent) ? "negative" : "neutral";
  const consent = value.consent !== "not_asked" ? value.consent : proposeDemo ? "pending" : "not_asked";
  return {
    replyText: value.reply,
    leadStage: stage,
    detectedIntent: value.intent,
    sentiment,
    summaryUpdate: null,
    memoryUpdates: value.memories.filter((item) => MEMORY_KEYS.has(item.key)).map((item) => ({ key: item.key as AiDecision["memoryUpdates"][number]["key"], value: item.value, evidenceType: item.evidence, confidence: item.confidence })),
    questionsAnswered: [],
    objectionsDetected: value.intent === "objection" ? [userMessage.slice(0, 300)] : [],
    shouldSendMaterial: value.material !== null,
    materialQuery: value.material,
    shouldProposeDemo: proposeDemo,
    suggestedSlots: [],
    shouldScheduleDemo: value.action === "confirm_demo",
    appointmentData: appointment,
    shouldHandoff,
    handoffReason: shouldHandoff ? `Encaminhamento solicitado (${value.handoff ?? value.intent}).` : null,
    shouldOptOut,
    followUpAction: terminal || shouldOptOut ? { action: "cancel", delayHours: null, reason: "Conversa encerrada ou encaminhada." } : { action: "schedule", delayHours: 48, reason: "Retomar somente se não houver resposta." },
    confidence: value.confidence,
    internalReasoningSummary: `Intent ${value.intent}; action ${value.action}.`,
    qualificationStatus: value.intent === "no_interest" || shouldOptOut ? "disqualified" : "discovering",
    handoffType: value.handoff,
    qualificationScore: 0,
    mariliaConsent: consent,
    action: value.action,
  };
}

function repairCompactDecision(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const decision = { ...(value as Record<string, unknown>) };
  if (typeof decision.reply === "string") decision.reply = decision.reply.slice(0, 1_600);
  if (typeof decision.material === "string") decision.material = decision.material.slice(0, 200);
  if (Array.isArray(decision.memories)) decision.memories = decision.memories.slice(0, 10).map((item) => item && typeof item === "object" ? { ...(item as Record<string, unknown>), key: String((item as Record<string, unknown>).key ?? "").slice(0, 50), value: String((item as Record<string, unknown>).value ?? "").slice(0, 500) } : item);
  return decision;
}

function validAppointment(value: z.infer<typeof providerDecisionSchema>["appointment"]): value is NonNullable<z.infer<typeof providerDecisionSchema>["appointment"]> {
  const valid = (item: string) => Number.isFinite(Date.parse(item)) && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item);
  return Boolean(value && valid(value.startsAt) && valid(value.endsAt));
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function repairMechanicalBounds(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const decision = { ...(value as Record<string, unknown>) };
  const truncate = (item: unknown, max: number) => typeof item === "string" ? item.slice(0, max) : item;
  const boundedStrings: Array<[string, number]> = [
    ["replyText", 1_600], ["summaryUpdate", 800], ["materialQuery", 300],
    ["handoffReason", 500], ["internalReasoningSummary", 500],
  ];
  for (const [key, max] of boundedStrings) if (key in decision) decision[key] = truncate(decision[key], max);
  for (const key of ["questionsAnswered", "objectionsDetected"] as const) {
    if (Array.isArray(decision[key])) decision[key] = decision[key].slice(0, 12).map((item) => truncate(item, 300));
  }
  if (Array.isArray(decision.suggestedSlots)) decision.suggestedSlots = decision.suggestedSlots.slice(0, 8);
  if (Array.isArray(decision.memoryUpdates)) {
    decision.memoryUpdates = decision.memoryUpdates.slice(0, 16).map((item) => item && typeof item === "object" && !Array.isArray(item)
      ? { ...(item as Record<string, unknown>), value: truncate((item as Record<string, unknown>).value, 1_000) }
      : item);
  }
  if (decision.appointmentData && typeof decision.appointmentData === "object" && !Array.isArray(decision.appointmentData)) {
    const appointment = decision.appointmentData as Record<string, unknown>;
    decision.appointmentData = { ...appointment, notes: truncate(appointment.notes, 1_000) };
  }
  if (decision.followUpAction && typeof decision.followUpAction === "object" && !Array.isArray(decision.followUpAction)) {
    const followUp = decision.followUpAction as Record<string, unknown>;
    decision.followUpAction = { ...followUp, reason: truncate(followUp.reason, 500) };
  }
  return decision;
}

function repairInvalidAppointment(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const decision = value as Record<string, unknown>;
  const appointment = decision.appointmentData;
  if (!appointment || typeof appointment !== "object" || Array.isArray(appointment)) return value;
  const data = appointment as Record<string, unknown>;
  const validDateTime = (item: unknown) => typeof item === "string" && Number.isFinite(Date.parse(item)) && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item);
  if (validDateTime(data.startsAt) && validDateTime(data.endsAt)) return value;
  return { ...decision, appointmentData: null, shouldScheduleDemo: true };
}

function closeObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(closeObjects);
  if (!value || typeof value !== "object") return value;
  // Gemini 3.5 rejects these annotation/size keywords in responseJsonSchema.
  // Zod still enforces them immediately after generation for both providers.
  const result: JsonSchema = Object.fromEntries(Object.entries(value as JsonSchema)
    .filter(([key]) => !["maxLength", "maxItems", "format"].includes(key))
    .map(([key, nested]) => [key, closeObjects(nested)]));
  if (result.type === "object" || result.properties !== undefined) {
    result.additionalProperties = false;
    // Groq's strict JSON-schema endpoint rejects nested objects with optional
    // properties and no `required` array. Zod still keeps these fields
    // backwards-compatible at the parsing boundary; the provider contract
    // must simply require the complete object when it is emitted.
    if (result.properties && typeof result.properties === "object") result.required = Object.keys(result.properties as Record<string, unknown>);
  }
  return result;
}
