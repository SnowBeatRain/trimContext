param(
  [string]$RepoUrl = $env:TRIMCTX_REPO_URL,
  [string]$Ref = $env:TRIMCTX_REF,
  [string]$InstallDir = $env:TRIMCTX_INSTALL_DIR,
  [string]$BinDir = $env:TRIMCTX_BIN_DIR,
  [string]$ClaudePluginDir = $env:TRIMCTX_CLAUDE_PLUGIN_DIR
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoUrl)) {
  $RepoUrl = "https://github.com/SnowBeatRain/trimContext.git"
}

if ([string]::IsNullOrWhiteSpace($Ref)) {
  $Ref = "main"
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "trimctx"
}

if ([string]::IsNullOrWhiteSpace($BinDir)) {
  $BinDir = Join-Path $env:USERPROFILE ".local\bin"
}

if ([string]::IsNullOrWhiteSpace($ClaudePluginDir)) {
  $ClaudePluginDir = Join-Path $env:USERPROFILE ".claude\plugins\trimctx"
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH. Install it and rerun this script."
  }
}

function Run-Step {
  param(
    [string]$Message,
    [scriptblock]$Command
  )
  Write-Host "[trimctx] $Message"
  & $Command
}

Require-Command git
Require-Command npm
Require-Command node

$nodeMajor = [int]((& node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) {
  throw "Node.js 20+ is required. Found: $(node --version)"
}

$installParent = Split-Path -Parent $InstallDir
$binParent = Split-Path -Parent $BinDir
$pluginParent = Split-Path -Parent $ClaudePluginDir
New-Item -ItemType Directory -Force -Path $installParent, $BinDir, $pluginParent | Out-Null

if (Test-Path (Join-Path $InstallDir ".git")) {
  Run-Step "Updating $InstallDir" {
    git -C $InstallDir fetch --depth 1 origin $Ref
    git -C $InstallDir checkout --force FETCH_HEAD
  }
} else {
  if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
  }
  Run-Step "Cloning $RepoUrl#$Ref to $InstallDir" {
    git clone --depth 1 --branch $Ref $RepoUrl $InstallDir
  }
}

Run-Step "Installing dependencies" {
  npm --prefix $InstallDir ci
}

Run-Step "Building CLI" {
  npm --prefix $InstallDir run build
}

$cmdPath = Join-Path $BinDir "trimctx.cmd"
$escapedCmdInstallDir = $InstallDir.Replace("%", "%%")
$escapedPsInstallDir = $InstallDir.Replace("`", "``").Replace('"', '`"')
$cmdContent = @"
@echo off
node "$escapedCmdInstallDir\dist\cli.js" %*
"@
Set-Content -Path $cmdPath -Value $cmdContent -Encoding ASCII

$ps1Shim = Join-Path $BinDir "trimctx.ps1"
$ps1Content = @"
& node "$escapedPsInstallDir\dist\cli.js" @args
"@
Set-Content -Path $ps1Shim -Value $ps1Content -Encoding UTF8

if (Test-Path $ClaudePluginDir) {
  Remove-Item -Recurse -Force $ClaudePluginDir
}
Run-Step "Installing Claude Code plugin into $ClaudePluginDir" {
  Copy-Item -Recurse -Force (Join-Path $InstallDir "plugins\trimctx") $ClaudePluginDir
}

& $cmdPath --version | Out-Null

Write-Host "[trimctx] Installed successfully."
Write-Host ""
Write-Host "CLI:"
Write-Host "  $cmdPath"
Write-Host ""
Write-Host "Claude Code plugin:"
Write-Host "  $ClaudePluginDir"
Write-Host ""
Write-Host "If 'trimctx' is not found, add this directory to PATH:"
Write-Host "  $BinDir"
Write-Host ""
Write-Host "Then restart Claude Code and run:"
Write-Host "  /trimctx"
