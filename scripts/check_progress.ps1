$j = Get-Content 'C:\Users\richi\Downloads\gemini-history-FINAL-093-of-093_progress.json' -Raw | ConvertFrom-Json
$file = Get-Item 'C:\Users\richi\Downloads\gemini-history-FINAL-093-of-093_progress.json'
$secondsSinceUpdate = ((Get-Date) - $file.LastWriteTime).TotalSeconds
Write-Output "Ingested: $($j.ingestedIds.Count)"
Write-Output "Failed: $($j.failedIds.Count)"
Write-Output "Last sidecar update: $([Math]::Round($secondsSinceUpdate)) sec ago"
