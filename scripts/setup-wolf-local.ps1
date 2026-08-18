$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
py -3.11 -m venv (Join-Path $root '.runtime\wolf-python')
$python = Join-Path $root '.runtime\wolf-python\Scripts\python.exe'
& $python -m pip install --upgrade pip
& $python -m pip install -r (Join-Path $root 'services\wolf-transcription\requirements.txt')
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { throw 'Ollama não encontrado no PATH.' }
$models = (& ollama list) -join "`n"
if ($models -notmatch 'qwen3.5:9b') { & ollama pull qwen3.5:9b }
dotnet build (Join-Path $root 'tools\wolf-audio-helper\WolfAudioHelper.csproj') -c Release
Write-Output 'THE WOLF LOCAL setup concluído.'
