param([switch]$Force)
$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$Expected = "Renova123 Captação"
if ((Split-Path -Leaf $ProjectRoot) -ne $Expected) { throw "Diretório inesperado; reset cancelado: $ProjectRoot" }
if (-not $Force) { $Answer = Read-Host "Isso remove volumes locais da Evolution e dados do Supabase local. Digite RESETAR para continuar"; if ($Answer -ne "RESETAR") { Write-Host "Cancelado."; exit 0 } }
if (Get-Command docker -ErrorAction SilentlyContinue) { docker compose --env-file (Join-Path $ProjectRoot "infra\evolution\.env") -f (Join-Path $ProjectRoot "infra\evolution\docker-compose.yml") down --volumes }
if (Get-Command supabase -ErrorAction SilentlyContinue) { supabase stop --no-backup }
if (Test-Path -LiteralPath (Join-Path $ProjectRoot ".runtime\mock-db.json")) { Remove-Item -LiteralPath (Join-Path $ProjectRoot ".runtime\mock-db.json") -Force }
Write-Host "Ambiente local removido. Arquivos do projeto e credenciais foram preservados." -ForegroundColor Green
