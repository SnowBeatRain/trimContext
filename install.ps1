param(
  [string]$RepoUrl = $env:TRIMCTX_REPO_URL,
  [string]$Ref = $env:TRIMCTX_REF,
  [string]$InstallDir = $env:TRIMCTX_INSTALL_DIR,
  [string]$BinDir = $env:TRIMCTX_BIN_DIR,
  [string]$ClaudePluginDir = $env:TRIMCTX_CLAUDE_PLUGIN_DIR
)

$ErrorActionPreference = "Stop"
$MarkerName = ".trimctx-install-marker"
$MarkerContent = "trimctx-plugin-v1"

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

function Run-NativeStep {
  param(
    [string]$Message,
    [scriptblock]$Command
  )
  Write-Host "[trimctx] $Message"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Message failed with exit code $LASTEXITCODE."
  }
}

function Resolve-SafeTarget {
  param(
    [string]$Path,
    [string]$Label
  )
  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw "Refusing to use an empty $Label."
  }
  if ($Path.IndexOfAny([char[]](0..31 + 127)) -ge 0) {
    throw "Refusing to use a $Label containing control characters."
  }

  $fullPath = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($fullPath)
  if ([string]::Equals($fullPath, $root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use the filesystem root as $Label."
  }
  if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    $userHomePath = [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\', '/')
    if ([string]::Equals($fullPath.TrimEnd('\', '/'), $userHomePath, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to use the user home as $Label."
    }
  }
  return $fullPath
}

function Assert-NotReparsePoint {
  param(
    [string]$Path,
    [string]$Label
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to replace a reparse-point ${Label}: $Path"
  }
}

function Assert-OwnedCheckout {
  param(
    [string]$Path,
    [string]$ExpectedOrigin
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  Assert-NotReparsePoint $Path "install directory"
  if (-not (Test-Path -LiteralPath $Path -PathType Container) -or
      -not (Test-Path -LiteralPath (Join-Path $Path ".git"))) {
    throw "Install directory exists but is not a trimctx git checkout: $Path"
  }

  $topLevel = ((& git -C $Path rev-parse --show-toplevel 2>$null) -join "`n").Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($topLevel)) {
    throw "Install directory is not a readable git checkout: $Path"
  }
  $resolvedTopLevel = [IO.Path]::GetFullPath($topLevel).TrimEnd('\', '/')
  if (-not [string]::Equals($resolvedTopLevel, $Path.TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase)) {
    throw "Install directory is not the git checkout root: $Path"
  }

  $origin = ((& git -C $Path remote get-url origin 2>$null) -join "`n").Trim()
  if ($LASTEXITCODE -ne 0 -or $origin -cne $ExpectedOrigin) {
    throw "Install directory git origin does not match the requested repository: $Path"
  }
}

function Test-TrimctxMarker {
  param([string]$Path)
  $marker = Join-Path $Path $MarkerName
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
    return $false
  }
  $content = [IO.File]::ReadAllText($marker)
  return $content -ceq "$MarkerContent`n" -or $content -ceq "$MarkerContent`r`n"
}

function Test-LegacyTrimctxPlugin {
  param([string]$Path)
  return (Test-Path -LiteralPath (Join-Path $Path ".claude-plugin\plugin.json") -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $Path ".system") -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $Path "commands\trimctx.md") -PathType Leaf)
}

function Assert-OwnedPlugin {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  Assert-NotReparsePoint $Path "Claude plugin directory"
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "Claude plugin target exists but is not a directory: $Path"
  }

  $marker = Join-Path $Path $MarkerName
  if (Test-Path -LiteralPath $marker) {
    if (-not (Test-TrimctxMarker $Path)) {
      throw "Claude plugin marker does not match trimctx ownership: $Path"
    }
    return
  }
  if (-not (Test-LegacyTrimctxPlugin $Path)) {
    throw "Claude plugin directory is not owned by trimctx: $Path"
  }
}

Require-Command git
Require-Command npm
Require-Command node

$nodeVersion = ((& node --version) -join "`n").Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Unable to read the Node.js version."
}
$nodeMajor = [int]($nodeVersion.TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) {
  throw "Node.js 20+ is required. Found: $nodeVersion"
}

$InstallDir = Resolve-SafeTarget $InstallDir "install directory"
$BinDir = Resolve-SafeTarget $BinDir "binary directory"
$ClaudePluginDir = Resolve-SafeTarget $ClaudePluginDir "Claude plugin directory"
Assert-OwnedCheckout $InstallDir $RepoUrl
Assert-OwnedPlugin $ClaudePluginDir

$installParent = Split-Path -Parent $InstallDir
$pluginParent = Split-Path -Parent $ClaudePluginDir
New-Item -ItemType Directory -Force -Path $installParent, $BinDir, $pluginParent | Out-Null

if (Test-Path -LiteralPath $InstallDir) {
  Run-NativeStep "Fetching $RepoUrl#$Ref" {
    git -C $InstallDir fetch --depth 1 origin $Ref
  }
  Run-NativeStep "Updating $InstallDir" {
    git -C $InstallDir checkout --force FETCH_HEAD
  }
} else {
  Run-NativeStep "Cloning $RepoUrl#$Ref to $InstallDir" {
    git clone --depth 1 --branch $Ref $RepoUrl $InstallDir
  }
}

Run-NativeStep "Installing dependencies" {
  npm --prefix $InstallDir ci
}

Run-NativeStep "Building CLI" {
  npm --prefix $InstallDir run build
}

$cmdPath = Join-Path $BinDir "trimctx.cmd"
$escapedCmdInstallDir = $InstallDir.Replace("%", "%%")
$escapedPsInstallDir = $InstallDir.Replace('`', '``').Replace('"', '`"')
$cmdContent = @"
@echo off
node "$escapedCmdInstallDir\dist\cli.js" %*
"@
Set-Content -LiteralPath $cmdPath -Value $cmdContent -Encoding ASCII

$ps1Shim = Join-Path $BinDir "trimctx.ps1"
$ps1Content = @"
& node "$escapedPsInstallDir\dist\cli.js" @args
"@
Set-Content -LiteralPath $ps1Shim -Value $ps1Content -Encoding UTF8

Assert-OwnedPlugin $ClaudePluginDir
if (Test-Path -LiteralPath $ClaudePluginDir) {
  Remove-Item -LiteralPath $ClaudePluginDir -Recurse -Force
}
Write-Host "[trimctx] Installing Claude Code plugin into $ClaudePluginDir"
Copy-Item -LiteralPath (Join-Path $InstallDir "plugins\trimctx") -Destination $ClaudePluginDir -Recurse -Force
if (-not (Test-TrimctxMarker $ClaudePluginDir)) {
  throw "Installed Claude plugin is missing the trimctx ownership marker: $ClaudePluginDir"
}

& $cmdPath --version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "trimctx executable did not run after installation."
}

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
