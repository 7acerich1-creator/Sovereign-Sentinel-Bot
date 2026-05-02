$nodes = Get-Process node -ErrorAction SilentlyContinue
if ($nodes) {
  Write-Output "node processes running:"
  $nodes | ForEach-Object { Write-Output "  PID $($_.Id) CPU=$($_.CPU) since $($_.StartTime)" }
} else {
  Write-Output "NO NODE PROCESSES RUNNING"
}
$j = Get-Content 'C:\Users\richi\Downloads\gemini-history-FINAL-093-of-093_progress.json' -Raw | ConvertFrom-Json
$file = Get-Item 'C:\Users\richi\Downloads\gemini-history-FINAL-093-of-093_progress.json'
$secAgo = ((Get-Date) - $file.LastWriteTime).TotalSeconds
Write-Output "Sidecar: $($j.ingestedIds.Count) ingested, $($j.failedIds.Count) failed, last write $([Math]::Round($secAgo))s ago"
