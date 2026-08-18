import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = path.resolve("supabase/migrations");
const sql = fs.readdirSync(migrationDirectory).filter((file) => file.endsWith(".sql")).sort().map((file) => fs.readFileSync(path.join(migrationDirectory, file), "utf8")).join("\n");

describe("migrations Supabase", () => {
  it("declara filas persistentes, claim concorrente e dead letter", () => {
    for (const table of ["outreach_queue", "ai_response_queue", "follow_up_queue", "failed_jobs"]) expect(sql).toMatch(new RegExp(`create table public\\.${table}`));
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/dead_letter/);
    expect(sql).toMatch(/deduplication_key/);
    expect(sql).toMatch(/insert into public\.lead_batch_members/i);
    expect(sql).toMatch(/insert into public\.outreach_queue/i);
  });

  it("mantém timestamps uniformes e dashboard nas filas canônicas", () => {
    expect(sql).toMatch(/alter table public\.audit_logs[\s\S]*add column if not exists updated_at timestamptz/i);
    expect(sql).toMatch(/queuePending[\s\S]*outreach_queue[\s\S]*ai_response_queue[\s\S]*follow_up_queue/i);
  });

  it("habilita RLS e mantém service role fora do frontend", () => {
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/grant execute[\s\S]*to service_role/i);
    expect(sql).toMatch(/revoke all[\s\S]*from public,anon,authenticated/i);
    expect(sql).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*=/i);
  });

  it("inclui todos os estados de lead e buckets privados", () => {
    for (const status of ["imported", "queued", "scheduled", "contacting", "contacted", "awaiting_reply", "replied", "qualifying", "interested", "demo_requested", "demo_scheduled", "handoff", "manual_service", "no_response", "converted", "lost", "opted_out", "invalid", "blocked", "failed"]) expect(sql).toContain(`'${status}'`);
    for (const bucket of ["materials", "knowledge", "message-media", "temporary"]) expect(sql).toContain(`'${bucket}'`);
  });

  it("persiste inbound Evolution sob lock e amplia a fila compatível", () => {
    expect(sql).toMatch(/persist_inbound_evolution_event/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/unread_count/i);
    expect(sql).toMatch(/evolution_event/i);
  });

  it("persiste execuções Groq e aplica opt-out atômico", () => {
    expect(sql).toMatch(/create table if not exists public\.agent_executions/i);
    expect(sql).toMatch(/provider text not null default 'groq' check \(provider = 'groq'\)/i);
    expect(sql).toMatch(/create or replace function public\.apply_lead_opt_out/i);
    for (const table of ["suppression_list", "leads", "conversations", "follow_ups", "outreach_queue", "ai_response_queue", "follow_up_queue", "jobs"]) expect(sql).toMatch(new RegExp(`(?:insert into|update) public\\.${table}`, "i"));
    expect(sql).toMatch(/grant execute on function public\.apply_lead_opt_out[\s\S]*to service_role/i);
  });
});
