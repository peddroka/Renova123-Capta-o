# Ambiente e variáveis

Copie `.env.example` para `.env`. Nunca versione `.env`.

## Públicas no navegador

- `VITE_API_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Exclusivas da API/worker

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DATABASE_URL`
- `GROQ_API_KEY`
- `EVOLUTION_API_KEY`
- `WEBHOOK_SECRET`
- `ENCRYPTION_KEY`

Qualquer variável secreta com prefixo `VITE_` é uma configuração inválida.

## Estado de simulação

- `MOCK_MODE=true` mantém as integrações externas desligadas.
- `MOCK_DB_PATH=.runtime/mock-db.json` persiste lotes, fila, configurações e auditoria entre API e worker.

## Portas padrão

- Painel: 5173
- API: 3333
- Evolution: 8080, vinculada a `127.0.0.1`
- Supabase CLI: 54321–54323

Use `doctor.ps1` para diagnosticar pré-requisitos e serviços.
