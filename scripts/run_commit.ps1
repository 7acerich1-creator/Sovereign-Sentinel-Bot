cd C:\Users\richi\Sovereign-Sentinel-Bot
git add src/tools/sapphire/task_orchestrator.ts
git diff --cached --stat
git commit -F .commit_msg.txt
Write-Output "COMMIT_EXIT=$LASTEXITCODE"
git push origin main
Write-Output "PUSH_EXIT=$LASTEXITCODE"
Remove-Item .commit_msg.txt -Force -ErrorAction SilentlyContinue
