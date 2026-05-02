$file = 'C:\Users\richi\Downloads\gemini-history-FINAL-093-of-093.json'
$chats = Get-Content $file -Raw | ConvertFrom-Json
$total = 0
$eligible = 0
foreach ($chat in $chats) {
  foreach ($turn in $chat.turns) {
    $total++
    if ($turn.text.Length -ge 80) { $eligible++ }
  }
}
Write-Output "Total turns: $total"
Write-Output "Eligible turns (>= 80 chars): $eligible"
