$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvFile = Join-Path $ProjectRoot "infra\evolution\.env"
$ComposeFile = Join-Path $ProjectRoot "infra\evolution\docker-compose.yml"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop não está instalado ou não está no PATH." }
if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Execute pnpm run setup e edite infra/evolution/.env." }
docker compose --env-file $EnvFile -f $ComposeFile up -d
