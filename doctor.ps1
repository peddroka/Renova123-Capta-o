$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot
$Checks = @(); $CriticalFailure = $false
function Add-Check($Name, $State, $Details, [bool]$Critical=$false) { $script:Checks += [PSCustomObject]@{ Verificacao=$Name; Estado=$State; Detalhes=$Details }; if ($Critical -and $State -ne "OK") { $script:CriticalFailure = $true } }
$Node = Get-Command node -ErrorAction SilentlyContinue; Add-Check "Node.js" $(if ($Node) { "OK" } else { "ERRO" }) $(if ($Node) { node --version } else { "Node 20+ ausente" }) $true
$Pnpm = try { corepack pnpm --version } catch { $null }; Add-Check "pnpm" $(if ($Pnpm) { "OK" } else { "ERRO" }) $(if ($Pnpm) { $Pnpm } else { "Corepack/pnpm indisponível" }) $true
$Docker = Get-Command docker -ErrorAction SilentlyContinue; Add-Check "Docker" $(if ($Docker) { "OK" } else { "MOCK" }) $(if ($Docker) { docker --version } else { "Evolution local indisponível; aplicação pode operar em mock" })
Add-Check "Dependências" $(if (Test-Path "node_modules") { "OK" } else { "ERRO" }) $(if (Test-Path "node_modules") { "Instaladas" } else { "Execute setup.ps1" }) $true
Add-Check ".env da aplicação" $(if ((Test-Path ".env") -or (Test-Path ".env.local")) { "OK" } else { "ERRO" }) $(if (Test-Path ".env") { "Presente em .env" } elseif (Test-Path ".env.local") { "Presente em .env.local" } else { "Ausente" }) $true
Add-Check ".env da Evolution" $(if (Test-Path "infra/evolution/.env") { "OK" } else { "MOCK" }) $(if (Test-Path "infra/evolution/.env") { "Presente" } else { "Evolution ficará desligada" })
$MigrationOutput = & node scripts/validate-migrations.mjs 2>&1; $Migration = $LASTEXITCODE; Add-Check "Migrations" $(if ($Migration -eq 0) { "OK" } else { "ERRO" }) $(if ($Migration -eq 0) { "Ordem e SQL validados" } else { $MigrationOutput }) $true
$Api = try { Invoke-RestMethod -Uri "http://127.0.0.1:3333/health" -TimeoutSec 2 } catch { $null }; Add-Check "API" $(if ($Api) { "OK" } else { "PARADA" }) $(if ($Api) { "$($Api.status) / $($Api.mode) / simulação=$($Api.simulationMode)" } else { "Execute start.ps1" })
$Web = try { Invoke-WebRequest -Uri "http://127.0.0.1:5173" -UseBasicParsing -TimeoutSec 2 } catch { $null }; Add-Check "Painel" $(if ($Web) { "OK" } else { "PARADO" }) $(if ($Web) { "HTTP $($Web.StatusCode)" } else { "Execute start.ps1" })
if ($Docker -and (Test-Path "infra/evolution/.env")) { $Compose = docker compose --env-file "infra/evolution/.env" -f "infra/evolution/docker-compose.yml" config --quiet 2>&1; Add-Check "Docker Compose" $(if ($LASTEXITCODE -eq 0) { "OK" } else { "ERRO" }) $(if ($LASTEXITCODE -eq 0) { "Configuração válida" } else { $Compose }) $true }
$Checks | Format-Table -AutoSize
if ($CriticalFailure) { exit 1 }; exit 0
