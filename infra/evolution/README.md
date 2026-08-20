# Evolution API local

Ambiente compartilhado para as instâncias independentes `renova123-francisco` e `renova123-pedro`. A imagem está fixada em `evoapicloud/evolution-api:v2.3.6`; nunca troque por `latest` sem auditoria do contrato e da licença. Não é necessário subir uma segunda Evolution API: cada sessão é separada pelo nome da instância.

## Primeiro uso

1. Copie `.env.example` para `.env` e gere três segredos longos e distintos.
2. Mantenha a porta `8080` ligada apenas a `127.0.0.1`.
3. Execute `docker compose config` e confirme que nenhum valor ficou vazio.
4. Inicie com `docker compose up -d` e acompanhe `docker compose ps` e `docker compose logs -f evolution-api`.
5. Abra a tela **Integrações > WhatsApp**, crie a instância, configure o webhook e gere o QR.

Os volumes `evolution_instances`, `evolution_postgres` e `evolution_redis` preservam sessão, banco e cache. O backup operacional deve incluir principalmente o volume Postgres e a pasta de instâncias. Não publique Postgres, Redis nem a chave da API.

## Atualização segura

1. Leia as notas oficiais entre a versão atual e a candidata, incluindo mudanças de licença.
2. Faça backup verificável dos volumes e exporte a configuração da instância.
3. Fixe a nova tag (e, em produção, preferencialmente o digest) em uma cópia descartável deste compose.
4. Execute os testes de contrato de `packages/integrations`, valide QR, webhook, texto, mídia e status em simulação.
5. Só então aplique a tag ao ambiente principal. Em regressão, restaure a tag anterior e os volumes do backup.

## Teste real guiado

Envios automatizados permanecem bloqueados enquanto `SIMULATION_MODE=true`, `REAL_SENDING_ENABLED=false` ou `MOCK_EVOLUTION=true`. Para um teste real, use um número controlado pela equipe, habilite o modo real conscientemente e utilize **Teste manual** na tela. A API exige a confirmação literal `ENVIAR TESTE MANUAL`; testes automatizados jamais a enviam.
