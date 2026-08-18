Add-Type -AssemblyName System.Speech
$directory = Join-Path (Get-Location) 'artifacts'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$path = Join-Path $directory 'wolf-speech-fixture.wav'
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 0
$synth.Volume = 100
$synth.SetOutputToWaveFile($path)
$synth.Speak('Teste do microfone. Meu nome é Pedro e estou testando o The Wolf.')
$synth.Dispose()
Write-Output $path
