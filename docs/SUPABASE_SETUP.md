# Supabase

## Projeto hospedado

1. Crie um projeto Supabase.
2. Preencha URL, anon key e service role no `.env` correto.
3. Use a Supabase CLI autenticada:

```powershell
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

4. Crie o usuário administrador em **Authentication → Users**.
5. Execute `supabase/seed/001_initial_data.sql` no SQL Editor.

## Segurança

- Signup público fica desativado.
- RLS exige perfil `admin` autenticado.
- `webhook_events` e `delivery_receipts` não têm acesso de anon/authenticated.
- O bucket `materials` é privado e aceita apenas MIME types cadastrados, até 25 MB.
- API/worker usam service role somente no servidor.

## Realtime

Habilite Realtime apenas nas tabelas necessárias ao painel, como `messages`, `jobs`, `appointments` e `handoffs`. RLS continua sendo aplicada às assinaturas do usuário.
