# Francisco always-on hardening

This bundle fixes two failure classes found in the 2026-08-19 source snapshot:

1. `francisco:start` launched `apps/worker/src/index.ts` directly. A graceful worker exit could leave the manager/API alive with no worker. The manager now launches the worker supervisor and treats *any* unexpected managed-child exit (including code 0) as a failed profile so systemd can restart it.
2. One transient Supabase heartbeat transport error could terminate the worker. Heartbeat now retries transport errors, keeps operating only while the last confirmed lease is still inside its TTL, and still fails closed immediately on explicit lease loss.
3. Conversation work is separated from proactive work. Disabling/pausing proactive automation no longer prevents the worker from claiming inbound/AI-response work. Proactive outreach remains gated by its schedule/settings.

## Production recommendation

Do not use the development profile manager as the long-term production process manager. Build the repo and run API and worker as separate systemd units. Templates are in `ops/systemd/`.

Before switching units, Codex must inspect the actual AWS state, current commit and current `francisco.service`. Never run the old `francisco.service` concurrently with `renova123-api.service` because both can bind port 3333.

Suggested safe migration sequence:

1. Keep commercial sending paused during the process migration, without disconnecting Evolution/WhatsApp.
2. `pnpm install --frozen-lockfile` only if dependencies changed; then `pnpm --filter @renova123/api build` and `pnpm --filter @renova123/worker build`.
3. Install the two unit files in `/etc/systemd/system/`, `systemctl daemon-reload`.
4. Stop/disable the legacy `francisco.service` before starting the new API unit.
5. Enable/start `renova123-api.service` and `renova123-worker.service`.
6. Verify localhost API, public API, worker heartbeat, scheduler heartbeat, Evolution state and WhatsApp state.
7. Verify the worker survives a controlled child termination: the supervisor must replace it without losing the API.
8. Verify a simulated/transient heartbeat transport failure does not permanently kill the worker.
9. Verify inbound replies continue 24/7 while proactive work is outside its window/paused.
10. Restore the user's prior commercial state only after health checks pass.

## Important semantic rule

- Francisco proactive first-contact/follow-up: 08:00–23:00 America/Sao_Paulo.
- Francisco conversation replies after a valid inbound: 24/7.
- A daily quota stopping first contacts is not a worker outage. Health/telemetry must distinguish `quota_exhausted`, `no_due_work`, `outside_proactive_window`, `proactive_paused`, and `worker_offline`.
