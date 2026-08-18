# Integração Evolution API

## Contrato validado

A integração foi conferida contra o código oficial da tag `2.3.6` (commit `3454bec79f514995df9a5ea36a3554ab35cf1c82`). O compose fixa `evoapicloud/evolution-api:v2.3.6`. O upgrade para 2.4+ exige nova análise funcional e de licença.

Endpoints usados pelo adapter: criação, conexão/QR, estado, restart, logout, exclusão, configuração de webhook, envio de texto/mídia/áudio, presença, leitura e download em base64. Na 2.3.6, o corpo de `webhook/set` usa `webhook.byEvents` e `webhook.base64` — não os nomes antigos `webhookByEvents` e `webhookBase64`.

## Limites de segurança

- `EVOLUTION_API_KEY`, service role e segredo do webhook existem apenas em API/worker.
- O webhook aceita no máximo 512 KiB, compara o segredo no header, sanitiza chaves sensíveis, deduplica antes da fila e responde `202` sem executar IA.
- Grupos, status, newsletters, JIDs inválidos e mensagens `fromMe` de upsert são ignorados.
- Envio real exige todos os flags de segurança, conexão aberta e ausência de opt-out, supressão, pausa ou takeover.
- Um POST de mensagem não é repetido automaticamente após resposta ambígua. A reserva idempotente local impede duplicação comercial.
- Payloads e logs removem API keys, tokens, segredos e senhas.

## Fluxo inbound

`POST /webhooks/evolution` → normalização → `webhook_events` → job `evolution_event` → worker → função `persist_inbound_evolution_event`.

A função usa advisory lock por owner/telefone e, numa transação, cria/encontra lead e conversa, salva a mensagem, incrementa não lidas, atualiza atividade, cancela follow-ups e incrementa o contador diário. Em seguida o worker respeita takeover/pausa, detecta opt-out ou aplica debounce de quatro segundos antes da fila de IA.

Áudio pode ser baixado e transcrito pelo modelo Groq configurado em `GROQ_WHISPER_MODEL` somente quando `TRANSCRIBE_AUDIO_ENABLED=true`. O arquivo fica no bucket privado `message-media`; nenhuma voz artificial é gerada.

## Diagnóstico e operação

A tela `/integracoes/whatsapp` cobre ciclo da instância, QR com expiração, webhook, restart, logout, teste manual e exclusão. `GET /whatsapp/diagnostics` retorna apenas metadados booleanos e status; nunca retorna credenciais.

O teste real é deliberadamente manual. Com mocks e simulação desligados, o endpoint exige a frase `ENVIAR TESTE MANUAL`. Consulte também `infra/evolution/README.md` para inicialização, backup e atualização.
