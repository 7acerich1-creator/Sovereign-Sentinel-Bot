@echo off
cd /d C:\Users\richi\Sovereign-Sentinel-Bot
set POD_FULL_TEST_CONFIRM=1
set POD_CLOUD_TYPE=COMMUNITY
call npx ts-node scripts/test-full-composition.ts > C:\Users\richi\Sovereign-Sentinel-Bot\test-s79.log 2>&1
echo DONE >> C:\Users\richi\Sovereign-Sentinel-Bot\test-s79.log
