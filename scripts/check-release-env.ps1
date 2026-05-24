$ErrorActionPreference = "Continue"

function Test-Command($Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    Write-Host "[ok] $Name -> $($command.Source)"
    try {
      $job = Start-Job -ScriptBlock {
        param($CommandName)
        try {
          $output = & $CommandName --version 2>&1
          [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output = (($output | Out-String).Trim())
          }
        } catch {
          [pscustomobject]@{
            ExitCode = -1
            Output = $_.Exception.Message
          }
        }
      } -ArgumentList $Name
      if (Wait-Job $job -Timeout 5) {
        $result = Receive-Job $job
        if ($result.ExitCode -eq 0) {
          Write-Host "[ok] $Name version: $($result.Output)"
        } else {
          Write-Host "[warn] $Name exists but version check failed"
          if ($result.Output) {
            if ($Name -eq "npm" -and $result.Output -match "npm-cli\.js") {
              Write-Host "       npm CLI files are missing or broken. Reinstall or repair Node.js before building installers."
            } else {
              $firstLine = (($result.Output -split '\r?\n') | Where-Object { $_ -match '\S' -and $_ -notmatch '^\s*node\.exe\s*:' } | Select-Object -First 1)
              if ($firstLine) {
                Write-Host "       $firstLine"
              }
            }
          }
        }
      } else {
        Stop-Job $job -Force
        Write-Host "[warn] $Name version check timed out"
      }
      Remove-Job $job -Force
    } catch {
      Write-Host "[warn] $Name exists but version check failed: $($_.Exception.Message)"
    }
  } else {
    Write-Host "[missing] $Name"
  }
}

Write-Host "CodexMaMi release environment check"
Write-Host ""
Test-Command node
Test-Command npm
Test-Command rustc
Test-Command cargo

Write-Host ""
if (Test-Path "src-tauri\tauri.conf.json") {
  Write-Host "[ok] Tauri config found"
} else {
  Write-Host "[missing] src-tauri\tauri.conf.json"
}
