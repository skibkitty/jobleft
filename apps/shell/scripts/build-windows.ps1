# Builds jobleft for Windows so that someone else can open it: the UI, the Node sidecar tree, and an NSIS installer
# per user (installMode: currentUser; WebView2 is fetched by the bootstrapper when a machine lacks it). This is the
# local counterpart of the installer step in .github/workflows/windows.yml, and it is the Windows answer to
# build-macos.sh — that one signs, notarizes and staples, none of which has a Windows equivalent yet (the installer
# is not code-signed, so SmartScreen warns; that is expected and documented in apps/shell/README.md).
#
# Usage: apps/shell\scripts\build-windows.ps1 [--skip-smoke]
#   JOBLEFT_PUBLIK_APP_TOKEN     the public publik app token (pat_jobleft_...); without it the app starts without
#                                JOBLEFT_PUBLIK_ALLOW_LIVE=1, so "Connect to publik" is refused in plain words.
#                                It can also live in the git-ignored apps/shell/publik-app-token.local.
#   --skip-smoke                 build only; do not install, start, check health and stop the app afterwards.
#
# Needs the Visual Studio Build Tools with the "MSVC v143 - VS 2022 C++ x64/x86 build tools" component for cl.exe.
# cl.exe does not have to be on PATH: cargo finds it through the same Visual Studio detection CI relies on.
[CmdletBinding()]
param(
  [switch]$SkipSmoke
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$Shell = Join-Path $Root 'apps\shell'
$TauriDir = Join-Path $Shell 'src-tauri'
# Cargo output goes to the shared target folder, never into the package (apps/shell/README.md). build-macos.sh does
# the same with `export CARGO_TARGET_DIR`, and .cache/ is git-ignored.
$env:CARGO_TARGET_DIR = Join-Path $Root '.cache\cargo-target'
$SetupDir = Join-Path $env:CARGO_TARGET_DIR 'release\bundle\nsis'

function Say($message) { Write-Host "==> $message" }

# --- Prerequisites. Each failure says what to install, because a first Rust/Tauri build is slow and a wrong toolchain
# --- only shows up as a link error ten minutes in.
Say 'Checking the toolchain'
# Parsed with PowerShell, not `node -p`: PowerShell 5.1 drops the double quotes out of an argument passed to a native
# exe, so any JS here loses its string delimiters.
$nodeMajor = [int](((node -v) -replace '^v', '') -split '\.')[0]
if ($nodeMajor -lt 24) { throw "Node 24 or newer is required (found $(node -v)); engines in apps/shell/package.json says >=24." }
"node $(node -v), pnpm $(pnpm --version)"

if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
  throw 'No rustc on PATH. Install the stable toolchain (https://rustup.rs) or let CI do the first build.'
}
"rust $(rustc --version)"

# The VC tools are an installed component, not a PATH entry, so ask the installer where they are.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vcTools = if (Test-Path $vswhere) { & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath } else { $null }
if (-not $vcTools) {
  throw "No MSVC C++ build tools found (vswhere: $vswhere). Install the Visual Studio Build Tools with the 'MSVC v143 - VS 2022 C++ x64/x86 build tools' component, or run: '$vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64'"
}
"MSVC tools: $vcTools"

# --- The CI sequence, in order. fetch-node is separate because it is easy to forget: pack.ts copies the sidecar
# --- Node into the tree, and without it the bundle has no runtime to start the server with.
Say 'Building the UI'
Push-Location $Root
try { pnpm --filter @jobleft/ui build | Out-Null } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "the UI build failed (exit $LASTEXITCODE)" }

Say 'Fetching the Node runtime for the sidecar'
node (Join-Path $Shell 'scripts\fetch-node.mjs') --target win-x64
if ($LASTEXITCODE -ne 0) { throw "fetch-node.mjs failed (exit $LASTEXITCODE)" }

Say 'Packing the sidecar tree'
node (Join-Path $Shell 'scripts\pack.ts') --target win-x64
if ($LASTEXITCODE -ne 0) { throw "pack.ts failed (exit $LASTEXITCODE)" }

# The Tauri CLI is run by its file in the pnpm store: `pnpm exec tauri` drops the link on this workspace's install policy.
Say 'Building the NSIS installer (the first build compiles every Rust dependency; expect several minutes)'
$cli = $null
Push-Location $Shell
try { $cli = (node -p "require.resolve('@tauri-apps/cli/tauri.js', { paths: ['.'] })") | Select-Object -Last 1 } finally { Pop-Location }
Push-Location $Shell
try { node $cli build --bundles nsis } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit $LASTEXITCODE)" }

$setup = Get-ChildItem -Path $SetupDir -Filter '*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw "No installer was produced in $SetupDir" }
Say ("Installer: {0} ({1} MB)" -f $setup.FullName, [math]::Round($setup.Length / 1MB, 1))

# --- The smoke test is the same one the workflow runs, so a locally built installer is proven the same way: installed
# --- silently, started, answering health, and stopped through the shutdown route (Windows has no SIGTERM).
# --- Crawling is switched off so this does not start a live crawl against real boards.
if ($SkipSmoke) {
  Write-Host "`nSkipped the smoke test (--skip-smoke)."
  exit 0
}

Say 'Smoke: install, start, health, stop'
Start-Process -FilePath $setup.FullName -ArgumentList '/S' -Wait
$exe = "$env:LOCALAPPDATA\jobleft\jobleft.exe"
if (-not (Test-Path $exe)) {
  $exe = (Get-ChildItem -Path "$env:LOCALAPPDATA", "$env:ProgramFiles" -Recurse -Filter 'jobleft.exe' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
if (-not $exe) { throw 'The installer ran but no jobleft.exe was found under LOCALAPPDATA or ProgramFiles.' }
"installed at: $exe"

$env:JOBLEFT_AUTO_CRAWL = '0'
$env:JOBLEFT_SEED_BOARDS = 'none'
$p = Start-Process -FilePath $exe -PassThru
$dataHome = if ($env:JOBLEFT_HOME) { $env:JOBLEFT_HOME } else { "$env:APPDATA\jobleft" }
$run = Join-Path $dataHome 'run\server.json'
$deadline = (Get-Date).AddSeconds(40)
while (-not (Test-Path $run) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (-not (Test-Path $run)) {
  Get-Content (Join-Path $dataHome 'logs\sidecar.log') -ErrorAction SilentlyContinue | Select-Object -Last 30
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  throw "no run/server.json after 40 s"
}
$j = Get-Content $run -Raw | ConvertFrom-Json
# The launch token is printed nowhere in this script: it is the x-jobleft-token header value and grants full access to
# the loopback API for as long as the app runs.
"server on port $($j.port), pid $($j.pid)"

$health = Invoke-RestMethod -Uri "http://127.0.0.1:$($j.port)/api/v1/health"
"health: $($health | ConvertTo-Json -Compress)"
if ($health.app -ne 'jobleft') { throw 'health did not answer jobleft' }

$shellFile = Join-Path $dataHome 'run\shell.json'
$deadline = (Get-Date).AddSeconds(20)
while (-not (Test-Path $shellFile) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
"window: $(if (Test-Path $shellFile) { Get-Content $shellFile -Raw } else { 'no run/shell.json (window not reported)' })"

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($j.port)/api/v1/shutdown" -Headers @{ 'x-jobleft-token' = $j.token } -ContentType 'application/json' -Body '{}' | Out-Null
Start-Sleep -Seconds 4
if (Get-Process -Id $j.pid -ErrorAction SilentlyContinue) { throw 'server still running after shutdown' }
"server stopped cleanly; run file gone: $(-not (Test-Path $run))"
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue

Write-Host "`nInstaller: $($setup.FullName)"
Write-Host "Data folder: $dataHome"