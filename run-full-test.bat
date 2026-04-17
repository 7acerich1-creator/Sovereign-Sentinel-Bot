@echo off
cd /d C:\Users\richi\Sovereign-Sentinel-Bot
set POD_FULL_TEST_CONFIRM=1
set POD_CLOUD_TYPE=COMMUNITY
npx ts-node scripts/test-full-composition.ts
