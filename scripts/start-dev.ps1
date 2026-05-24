$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$env:CODEXMAMI_HOME = Join-Path $root ".codexmami-dev"
if (-not $env:PORT) {
  $preferredPort = 4173
  $port = $preferredPort
  while ($true) {
    $listener = $null
    try {
      $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $port)
      $listener.Start()
      $listener.Stop()
      break
    } catch {
      if ($listener) {
        $listener.Stop()
      }
      $port += 1
      if ($port -gt ($preferredPort + 50)) {
        throw "No free local port found from $preferredPort to $port."
      }
    }
  }
  $env:PORT = [string]$port
}

Write-Host "Starting CodexMaMi..."
Write-Host "URL: http://127.0.0.1:$env:PORT"
Write-Host "Data: $env:CODEXMAMI_HOME"

Set-Location $root
node server.mjs
