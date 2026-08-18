$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $ProjectRoot ".runtime\dev.pids"
function Stop-Tree([int]$RootId) { $Children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $RootId }; foreach ($Child in $Children) { Stop-Tree ([int]$Child.ProcessId) }; Stop-Process -Id $RootId -Force -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath $PidFile) { foreach ($ProcessId in (Get-Content $PidFile)) { Stop-Tree ([int]$ProcessId) }; Remove-Item -LiteralPath $PidFile -Force; Write-Host "Web, API e worker encerrados." -ForegroundColor Green } else { Write-Host "Nenhum processo registrado pela aplicação." -ForegroundColor Yellow }
if ((Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $ProjectRoot "infra\evolution\.env"))) { & (Join-Path $ProjectRoot "scripts\stop-evolution.ps1") }
