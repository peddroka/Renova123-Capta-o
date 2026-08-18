# Solução de problemas

## O painel abre, mas não carrega dados

Confirme `VITE_API_URL`, execute `doctor.ps1` e veja `.runtime/dev.err.log` quando iniciado por `start.ps1`.

## O painel redireciona ou a API retorna 401

Verifique `MOCK_MODE=true` e abra o painel pelo servidor de desenvolvimento em `http://127.0.0.1:5173`. Reinicie com `restart.ps1`. A preparação correta é `pnpm run setup`; `pnpm setup` sozinho chama o configurador interno do pnpm.

## QR Code não aparece

Confirme Docker ativo, containers saudáveis, mesma `EVOLUTION_API_KEY` nos dois `.env` e porta 8080 livre. Em v2.4+, verifique também a exigência de ativação/licença.

## Webhook retorna 401

Regere a configuração pela tela de WhatsApp. `WEBHOOK_SECRET` deve ser o mesmo processo da API que registrou a URL.

## Groq retorna 429

O worker fará backoff. Reduza cadência, confira limites da conta e observe a fila. Não habilite outro provedor como fallback.

## Migration falha

Execute `pnpm db:validate`, confirme PostgreSQL 15 e aplique em ordem. Não edite migrations já aplicadas; crie uma nova migration corretiva.
