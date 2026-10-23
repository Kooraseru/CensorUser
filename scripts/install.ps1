# Remote-friendly bootstrap for Windows PowerShell.
$ErrorActionPreference = 'Stop'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }
$root = Join-Path $env:LOCALAPPDATA 'CensorUser'
$repo = Join-Path $root 'Plugin'
$vencord = Join-Path $root 'Vencord'
$firstRun = -not (Test-Path -LiteralPath (Join-Path $vencord '.git'))
New-Item -ItemType Directory -Force -Path $root | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    if (Test-Path -LiteralPath $repo) { throw "Refusing to replace existing non-Git folder: $repo" }
    & git clone https://github.com/Kooraseru/CensorUser.git $repo
    if ($LASTEXITCODE -ne 0) { throw 'Failed to clone CensorUser.' }
}
& (Join-Path $repo 'scripts\sync.ps1') -VencordPath $vencord -Inject:$firstRun
if (-not $?) { throw 'CensorUser installation failed.' }
