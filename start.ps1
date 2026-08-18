param([switch]$Foreground)
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot
if (-not (Test-Path -LiteralPath ".env") -and -not (Test-Path -LiteralPath ".env.local")) { throw "Execute .\setup.ps1 antes de iniciar." }
if (-not (Test-Path -LiteralPath "node_modules")) { throw "Dependências ausentes. Execute .\setup.ps1." }
if ((Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath "infra/evolution/.env")) { & (Join-Path $ProjectRoot "scripts\start-evolution.ps1") } else { Write-Host "Evolution não iniciada; modo mock disponível." -ForegroundColor Yellow }
$RuntimeDir = Join-Path $ProjectRoot ".runtime"; New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$PidFile = Join-Path $RuntimeDir "dev.pids"
$ApiPort = 3333
$PortLine = @(Get-Content ".env.local" -ErrorAction SilentlyContinue; Get-Content ".env" -ErrorAction SilentlyContinue) | Where-Object { $_ -match '^LOCAL_API_PORT\s*=' } | Select-Object -First 1
if ($PortLine -match '=\s*(\d+)') { $ApiPort = [int]$Matches[1] }
$OccupiedApi = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue
if ($OccupiedApi) { throw "A porta $ApiPort já está ocupada pelo PID $($OccupiedApi.OwningProcess). O processo antigo não será mascarado." }
if (Test-Path -LiteralPath $PidFile) { $Alive = Get-Content $PidFile | ForEach-Object { Get-Process -Id ([int]$_) -ErrorAction SilentlyContinue } | Where-Object { $_ }; if ($Alive) { Write-Host "Aplicação já iniciada: $($Alive.Id -join ', ')." -ForegroundColor Yellow; exit 0 }; Remove-Item -LiteralPath $PidFile -Force }
if ($Foreground) { Write-Host "No modo foreground, use três terminais com API, web e worker conforme docs/OPERATIONS.md."; exit 0 }
$Api = Start-Process -FilePath "node" -ArgumentList @("node_modules/tsx/dist/cli.mjs","apps/api/src/server.ts") -WorkingDirectory $ProjectRoot -RedirectStandardOutput (Join-Path $RuntimeDir "api.out.log") -RedirectStandardError (Join-Path $RuntimeDir "api.err.log") -PassThru -WindowStyle Hidden
$Web = Start-Process -FilePath "node" -ArgumentList @("node_modules/vite/bin/vite.js","--host","127.0.0.1") -WorkingDirectory (Join-Path $ProjectRoot "apps\web") -RedirectStandardOutput (Join-Path $RuntimeDir "web.out.log") -RedirectStandardError (Join-Path $RuntimeDir "web.err.log") -PassThru -WindowStyle Hidden
$Worker = Start-Process -FilePath "node" -ArgumentList @("node_modules/tsx/dist/cli.mjs","apps/worker/src/index.ts") -WorkingDirectory $ProjectRoot -RedirectStandardOutput (Join-Path $RuntimeDir "worker.out.log") -RedirectStandardError (Join-Path $RuntimeDir "worker.err.log") -PassThru -WindowStyle Hidden
Set-Content -LiteralPath $PidFile -Value @($Api.Id,$Web.Id,$Worker.Id)
Start-Sleep -Seconds 2
$Health = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/health" -TimeoutSec 5
if ($Health.status -ne "ok") { throw "API iniciou, mas health check retornou status $($Health.status)." }
foreach ($Item in @(@{Name="API";Process=$Api},@{Name="Web";Process=$Web},@{Name="Worker";Process=$Worker})) { if (-not (Get-Process -Id $Item.Process.Id -ErrorAction SilentlyContinue)) { $Log = Join-Path $RuntimeDir "$($Item.Name.ToLower()).err.log"; throw "$($Item.Name) não iniciou. Consulte $Log" } }
Write-Host "Web, API e worker iniciados: $($Api.Id), $($Web.Id), $($Worker.Id)." -ForegroundColor Green
Write-Host "Painel http://127.0.0.1:5173 | API http://127.0.0.1:$ApiPort/health"
