# Sync standalone CensorUser + upstream Vencord, then build a local Discord bundle.
[CmdletBinding()]
param(
    [string]$VencordPath = (Join-Path $env:LOCALAPPDATA 'CensorUser\Vencord'),
    [switch]$Inject,
    [switch]$NoUpdate
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pluginSource = Join-Path $repoRoot 'plugin\index.tsx'

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing $Name in PATH. Install it before running this script."
    }
}

function Run-External([string]$Tool, [string[]]$Arguments) {
    Write-Host "> $Tool $($Arguments -join ' ')"
    & $Tool @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Tool failed (exit code $LASTEXITCODE)."
    }
}

Assert-Command 'git'
Assert-Command 'node'
Assert-Command 'pnpm'
if (-not (Test-Path -LiteralPath $pluginSource -PathType Leaf)) {
    throw "Missing plugin source: $pluginSource"
}

if (-not $NoUpdate -and (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
    $remotes = @(& git -C $repoRoot remote)
    if ($LASTEXITCODE -eq 0 -and $remotes -contains 'origin') {
        Run-External -Tool 'git' -Arguments @('-C', $repoRoot, 'pull', '--ff-only')
    }
}

$parent = Split-Path -Parent $VencordPath
if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
}

if (-not (Test-Path -LiteralPath (Join-Path $VencordPath '.git'))) {
    if (Test-Path -LiteralPath $VencordPath) {
        throw "Refusing to overwrite non-Git Vencord directory: $VencordPath"
    }
    Run-External -Tool 'git' -Arguments @('clone', 'https://github.com/Vendicated/Vencord.git', $VencordPath)
} elseif (-not $NoUpdate) {
    Run-External -Tool 'git' -Arguments @('-C', $VencordPath, 'pull', '--ff-only')
}

$targetDir = Join-Path $VencordPath 'src\userplugins\censorUser'
$targetFile = Join-Path $targetDir 'index.tsx'
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item -LiteralPath $pluginSource -Destination $targetFile -Force

Push-Location $VencordPath
try {
    Run-External -Tool 'pnpm' -Arguments @('install', '--frozen-lockfile')
    Run-External -Tool 'pnpm' -Arguments @('build')
    if ($Inject) {
        Write-Host 'Opening the Vencord installer. Select your Discord installation.'
        Run-External -Tool 'pnpm' -Arguments @('inject')
    }
} finally {
    Pop-Location
}

Write-Host "CensorUser synced and Vencord built at: $VencordPath"
if (-not $Inject) { Write-Host 'Restart or reload Discord to load the updated bundle.' }
