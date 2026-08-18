param([switch]$SkipInstall)
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot
Write-Host "Renova123 Captação - preparação local" -ForegroundColor Green
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20 ou superior não foi encontrado." }
$NodeMajor = [int]((node --version).TrimStart('v').Split('.')[0]); if ($NodeMajor -lt 20) { throw "Node.js 20 ou superior é obrigatório." }
corepack enable | Out-Null
$Docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $Docker) { Write-Host "Docker não encontrado: a aplicação funcionará em mock, sem Evolution local." -ForegroundColor Yellow }
if (-not $SkipInstall) { corepack pnpm install --frozen-lockfile }
if (-not (Test-Path -LiteralPath ".env")) { Copy-Item -LiteralPath ".env.example" -Destination ".env"; Write-Host "Criado .env em modo mock." -ForegroundColor Yellow }
if (-not (Test-Path -LiteralPath "infra/evolution/.env")) { Copy-Item -LiteralPath "infra/evolution/.env.example" -Destination "infra/evolution/.env"; Write-Host "Criado env da Evolution; troque as senhas antes do uso real." -ForegroundColor Yellow }
node scripts/validate-migrations.mjs
if (Get-Command supabase -ErrorAction SilentlyContinue) { Write-Host "Supabase CLI encontrado. Vincule o projeto e execute supabase db push." } else { Write-Host "Aplique supabase/migrations pelo painel ou CLI do Supabase." -ForegroundColor Yellow }
if ($Docker) { docker compose --env-file (Join-Path $ProjectRoot "infra\evolution\.env") -f (Join-Path $ProjectRoot "infra\evolution\docker-compose.yml") config --quiet; & (Join-Path $ProjectRoot "scripts\start-evolution.ps1") }
foreach ($Port in @(3333,5173,8080)) { if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { Write-Host "Porta $Port já está em uso." -ForegroundColor Yellow } }
Write-Host "Preparação concluída. Aplique migrations e execute .\start.ps1" -ForegroundColor Green
