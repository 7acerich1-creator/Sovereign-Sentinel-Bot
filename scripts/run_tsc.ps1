cd C:\Users\richi\Sovereign-Sentinel-Bot
$result = npx tsc --noEmit 2>&1 | Select-Object -First 30
$result | ForEach-Object { Write-Output $_ }
Write-Output "TSC_EXIT=$LASTEXITCODE"
