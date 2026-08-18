# Operação

- `setup.ps1`: valida Node/pnpm/Docker/env, instala pelo lockfile, valida migrations/Compose e inicia Evolution quando disponível.
- `start.ps1`: inicia Evolution, web, API e worker diretamente com Node; PIDs/logs separados ficam em `.runtime`.
- `stop.ps1`: encerra processos registrados e Compose.
- `restart.ps1`: parada e nova subida.
- `doctor.ps1`: ferramentas, envs, migrations, Compose e endpoints; Docker ausente é aceitável em mock.
- `reset-local.ps1`: com confirmação, remove volumes locais e mock DB; preserva código e credenciais.

Use Saúde para diagnóstico read-only. Observe fila falha, heartbeat, consumo e notificações. Em incidente, ative a parada geral antes de alterar credenciais ou reiniciar integrações.

Teste real de WhatsApp exige credenciais válidas, QR conectado, webhook configurado, número fornecido pelo usuário e confirmação explícita. Nunca selecione contato aleatório da base.
