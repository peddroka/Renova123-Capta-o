# Evolution API

O Compose está em `infra/evolution/docker-compose.yml` e cria API, PostgreSQL e Redis com volumes separados. A API fica disponível apenas em `127.0.0.1:8080`.

## Preparação

1. Instale Docker Desktop.
2. Copie `infra/evolution/.env.example` para `infra/evolution/.env`.
3. Gere valores longos e diferentes para chave da API, senha PostgreSQL e senha Redis.
4. Mantenha a senha dentro de `DATABASE_CONNECTION_URI` e `CACHE_REDIS_URI` igual às variáveis correspondentes.
5. Copie a chave da API para `EVOLUTION_API_KEY` no `.env` raiz.

## Iniciar

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-evolution.ps1
```

Depois inicie `pnpm dev`, abra **Configuração do WhatsApp** e gere o QR.

## Versão

O projeto fixa `evoapicloud/evolution-api:v2.3.6`. A versão 2.4.0 introduziu ativação obrigatória por licença; qualquer upgrade deve ser testado e ter seus termos avaliados antes de mudar a tag. Consulte as [releases oficiais](https://github.com/evolution-foundation/evolution-api/releases) e o [Compose oficial](https://github.com/evolution-foundation/evolution-api/blob/main/docker-compose.yaml).

## Webhook

A API registra por instância os eventos `CONNECTION_UPDATE`, `MESSAGES_UPSERT`, `MESSAGES_UPDATE` e `SEND_MESSAGE`. O segredo é acrescentado à URL; a API faz comparação em tempo constante, persiste o `event_id` e ignora repetidos.
