$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $ProjectRoot "stop.ps1")
& (Join-Path $ProjectRoot "start.ps1")
