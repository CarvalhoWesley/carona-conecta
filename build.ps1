# Gera dist/carona-conecta-v<versão>.zip com só os arquivos que a extensão usa.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
$files = 'manifest.json', 'background.js', 'sidepanel.html', 'sidepanel.css', 'sidepanel.js', 'lib', 'icons'

$stage = Join-Path dist 'carona-conecta'
Remove-Item dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $stage | Out-Null
Copy-Item $files $stage -Recurse

$zip = "dist/carona-conecta-v$version.zip"
Compress-Archive -Path $stage -DestinationPath $zip
Remove-Item $stage -Recurse -Force
Write-Host "Gerado $zip"
