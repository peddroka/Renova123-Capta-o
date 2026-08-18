import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";

loadEnv({ path: [resolve(".env.local"), resolve(".env")], override: false, quiet: true });

const baseUrl = (process.env.EVOLUTION_BASE_URL ?? process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
const apiKey = process.env.EVOLUTION_API_KEY ?? process.env.AUTHENTICATION_API_KEY ?? "";
const instance = process.env.EVOLUTION_INSTANCE_NAME ?? "renova123-francisco";
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !apiKey || !supabaseUrl || !serviceKey) throw new Error("Configuração operacional incompleta.");

const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function evolution(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", apikey: apiKey, ...(init.headers ?? {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function records(value: any): any[] {
  if (Array.isArray(value)) return value;
  for (const candidate of [value?.messages?.records, value?.messages, value?.records, value?.data?.messages?.records, value?.data?.messages, value?.data]) if (Array.isArray(candidate)) return candidate;
  return [];
}

function textOf(row: any) {
  return row?.message?.conversation ?? row?.message?.extendedTextMessage?.text ?? row?.message?.imageMessage?.caption ?? row?.message?.videoMessage?.caption ?? row?.text ?? row?.body ?? null;
}

async function main() {
  const contacts = ["5511992468815", "5511974442893", "5567981098066"];
  const webhook = await evolution(`/webhook/find/${encodeURIComponent(instance)}`);
  const output: Record<string, unknown> = {
    webhook: {
      enabled: webhook?.enabled ?? webhook?.webhook?.enabled ?? webhook?.data?.enabled ?? webhook?.data?.webhook?.enabled ?? null,
      urlConfigured: Boolean(webhook?.url ?? webhook?.webhook?.url ?? webhook?.data?.url ?? webhook?.data?.webhook?.url),
      events: webhook?.events ?? webhook?.webhook?.events ?? webhook?.data?.events ?? webhook?.data?.webhook?.events ?? null,
    },
    contacts: {},
  };
  const recentRaw = await evolution(`/chat/findMessages/${encodeURIComponent(instance)}`, { method: "POST", body: JSON.stringify({ page: 1, offset: 500 }) });
  const recent = records(recentRaw);
  const since = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  const eventQuery = await db.from("integration_events").select("id,external_event_id,event_type,status,payload,error_message,created_at,processed_at").eq("provider", "evolution").gte("created_at", since).order("created_at");
  if (eventQuery.error) throw eventQuery.error;
  const webhookQuery = await db.from("webhook_events").select("id,event_id,event_type,payload,received_at,processed_at").gte("received_at", since).order("received_at");
  if (webhookQuery.error) throw webhookQuery.error;
  for (const phone of contacts) {
    let raw;
    try {
      raw = await evolution(`/chat/findMessages/${encodeURIComponent(instance)}`, { method: "POST", body: JSON.stringify({ where: { key: { remoteJid: `${phone}@s.whatsapp.net` } }, page: 1, offset: 100 }) });
    } catch {
      raw = await evolution(`/chat/findMessages/${encodeURIComponent(instance)}`, { method: "POST", body: JSON.stringify({ where: { key: { remoteJid: phone } }, page: 1, offset: 100 }) });
    }
    const messages = records(raw).map((row) => ({ id: row?.key?.id ?? row?.id ?? null, fromMe: row?.key?.fromMe ?? row?.fromMe ?? null, remoteJid: row?.key?.remoteJid ?? row?.remoteJid ?? null, timestamp: row?.messageTimestamp ?? row?.timestamp ?? row?.createdAt ?? null, type: row?.messageType ?? null, text: textOf(row) }));
    const recentMatches = recent.filter((row) => JSON.stringify(row).includes(phone)).map((row) => ({ id: row?.key?.id ?? row?.id ?? null, fromMe: row?.key?.fromMe ?? row?.fromMe ?? null, remoteJid: row?.key?.remoteJid ?? row?.remoteJid ?? null, remoteJidAlt: row?.key?.remoteJidAlt ?? row?.remoteJidAlt ?? null, timestamp: row?.messageTimestamp ?? row?.timestamp ?? row?.createdAt ?? null, type: row?.messageType ?? null, text: textOf(row) }));
    const events = (eventQuery.data ?? []).filter((row) => JSON.stringify(row.payload ?? {}).includes(phone)).map((row) => ({ id: row.id, externalEventId: row.external_event_id, eventType: row.event_type, status: row.status, error: row.error_message, createdAt: row.created_at, processedAt: row.processed_at }));
    const webhooks = (webhookQuery.data ?? []).filter((row) => JSON.stringify(row.payload ?? {}).includes(phone)).map((row) => ({ id: row.id, eventId: row.event_id, eventType: row.event_type, receivedAt: row.received_at, processedAt: row.processed_at, payload: row.payload }));
    (output.contacts as Record<string, unknown>)[phone] = { evolutionResponse: raw, evolutionMessages: messages, recentEvolutionMatches: recentMatches, persistedWebhooks: webhooks, persistedIntegrationEvents: events };
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
