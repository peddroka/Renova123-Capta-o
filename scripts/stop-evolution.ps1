$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
docker compose --env-file (Join-Path $ProjectRoot "infra\evolution\.env") -f (Join-Path $ProjectRoot "infra\evolution\docker-compose.yml") down
