import { z } from "zod";

export const agentSlugs = ["francisco", "pedro"] as const;
export type AgentSlug = (typeof agentSlugs)[number];

export type AgentConfig = {
  agentId: string;
  slug: AgentSlug;
  name: string;
  dailyLimit: number;
  operationalStart: string;
  operationalEnd: string;
  timezone: string;
  automationEnabled: boolean;
  globalPause: boolean;
  outreachEnabled: boolean;
  realSendingEnabled: boolean;
};

export const pedroInitialConfig: Omit<AgentConfig, "agentId"> = {
  slug: "pedro", name: "Pedro", dailyLimit: 50, operationalStart: "08:00", operationalEnd: "17:00",
  timezone: "America/Sao_Paulo", automationEnabled: false, globalPause: true,
  outreachEnabled: false, realSendingEnabled: false,
};

export const agentConfigSchema = z.object({
  agentId: z.string().uuid(), slug: z.enum(agentSlugs), name: z.string().min(1), dailyLimit: z.number().int().positive(),
  operationalStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), operationalEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1), automationEnabled: z.boolean(), globalPause: z.boolean(),
  outreachEnabled: z.boolean(), realSendingEnabled: z.boolean(),
});

export function agentQueueScope(slug: AgentSlug, queue: string) { return `${slug}:${queue}`; }
