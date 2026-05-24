param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$packagePath = Join-Path $root "package.json"
$tauriConfigPath = Join-Path $root "src-tauri\tauri.conf.json"
$cargoTomlPath = Join-Path $root "src-tauri\Cargo.toml"

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version must use semver like 0.2.0"
}

$package = Get-Content -Raw $packagePath | ConvertFrom-Json
$package.version = $Version
$package | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $packagePath

$tauri = Get-Content -Raw $tauriConfigPath | ConvertFrom-Json
$tauri.version = $Version
$tauri | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $tauriConfigPath

$cargo = Get-Content -Raw $cargoTomlPath
$cargo = [regex]::Replace($cargo, '(?m)^version = \".*\"$', "version = `"$Version`"", 1)
Set-Content -Encoding UTF8 $cargoTomlPath $cargo

Write-Host "Synced version to $Version"
