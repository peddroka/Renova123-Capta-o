# Segurança

- Auth e RLS isolam o proprietário; service role existe somente em API/worker.
- Segredos são tipados, ficam em env/backend, são mascarados no painel e redigidos nos logs.
- Storage é privado; prévias assinadas expiram em cinco minutos.
- Materiais e conhecimento usam arquivamento; referências históricas não quebram.
- `human_active`/`ai_paused`, opt-out, pausa geral, horários e limites são revalidados imediatamente antes de ações.
- Webhooks, jobs e mensagens possuem deduplicação/idempotência; retry não repete envio reservado.
- Logs removem authorization, API keys, service role, passwords, secrets e tokens; texto excessivo é truncado.
- Prompt do lead é dado não confiável e não pode mudar regras, revelar prompt/segredo nem autorizar promessa comercial.
- Envio real requer flags coerentes e número de teste explícito; nenhuma rota escolhe telefone automaticamente.

O operador é responsável por base legal das listas, políticas do WhatsApp, rotação de credenciais e backups separados do Supabase e da Evolution.
