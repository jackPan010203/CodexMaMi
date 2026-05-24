$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root ".codexmami-dev\server.log"
New-Item -ItemType Directory -Force (Split-Path -Parent $log) | Out-Null

if ($env:PORT) {
  $port = [int]$env:PORT
} else {
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
}
$appHome = Join-Path $root ".codexmami-dev"

$command = "`$env:PORT='$port'; `$env:CODEXMAMI_HOME='$appHome'; Set-Location '$root'; node server.mjs *> '$log'"
$process = Start-Process -FilePath powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command -WindowStyle Hidden -PassThru

Write-Host "Started CodexMaMi PID $($process.Id)"
Write-Host "URL: http://127.0.0.1:$port"
Write-Host "Log: $log"
