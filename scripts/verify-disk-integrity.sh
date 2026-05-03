#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# verify-disk-integrity.sh
# Run THIS first, every session, before any edit work.
#
# Detects the FUSE-write-truncation failure mode that silently broke
# files (mid-2026) by:
#   - trailing NUL-byte padding (file looks long, ends in ^@^@^@...)
#   - mid-string truncation (file ends mid-quote / mid-statement)
#   - JSON files that parse-fail at runtime (bot crashes silently)
#   - a tsc --noEmit failure
#
# If anything fails: STOP. Don't edit. Restore truncated files via
# `git show HEAD:<path> > /tmp/x && cp /tmp/x <path>` (or splice
# disk[1..N] + git[N+1..end] if your session edits matter and weren't
# yet committed). Strip trailing NULs with the node one-liner below.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
FAIL=0

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Sovereign-Sentinel-Bot — Disk Integrity Check"
echo "Repo: $ROOT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Trailing NUL bytes ─────────────────────────────────────────────
echo "[1/4] Trailing NUL bytes in src/ ..."
NUL_FILES=$(node -e "
const fs=require('fs'),path=require('path');
function walk(d,a=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name);
  if(e.isDirectory())walk(p,a);
  else if(/\.(ts|tsx|js|json)\$/.test(e.name))a.push(p);
}return a;}
const bad=[];
for(const f of walk('src')){
  const buf=fs.readFileSync(f);
  if(buf.length===0)continue;
  let end=buf.length;
  while(end>0&&buf[end-1]===0)end--;
  if(end<buf.length)bad.push(f+':'+(buf.length-end));
}
if(bad.length===0)console.log('OK');else{console.log('FAIL');for(const b of bad)console.log('  '+b+' trailing NUL bytes');}
")
echo "$NUL_FILES"
if echo "$NUL_FILES" | grep -q FAIL; then FAIL=1; fi
echo ""

# ── 2. JSON parse check ──────────────────────────────────────────────
echo "[2/4] JSON parse — every src/data/*.json ..."
JSON_RES=$(node -e "
const fs=require('fs'),path=require('path');
const dir='src/data';
let bad=[];
for(const f of fs.readdirSync(dir)){
  if(!f.endsWith('.json'))continue;
  const p=path.join(dir,f);
  try{JSON.parse(fs.readFileSync(p,'utf8'));}
  catch(e){bad.push(p+' — '+e.message);}
}
if(bad.length===0)console.log('OK');else{console.log('FAIL');for(const b of bad)console.log('  '+b);}
")
echo "$JSON_RES"
if echo "$JSON_RES" | grep -q FAIL; then FAIL=1; fi
echo ""

# ── 3. tsc --noEmit ──────────────────────────────────────────────────
echo "[3/4] tsc --noEmit ..."
if [ -x "./node_modules/.bin/tsc" ]; then
  TSC_OUT=$(./node_modules/.bin/tsc --noEmit 2>&1 | head -20)
  if [ -z "$TSC_OUT" ]; then
    echo "OK"
  else
    echo "FAIL"
    echo "$TSC_OUT"
    FAIL=1
  fi
else
  echo "SKIP (tsc not installed; run npm install)"
fi
echo ""

# ── 4. Disk-vs-git size sanity ───────────────────────────────────────
# Files where disk is significantly smaller than git HEAD = likely truncated.
echo "[4/4] Disk-vs-git size sanity (flag files where disk << git) ..."
SIZE_RES=$(node -e "
const fs=require('fs'),path=require('path'),cp=require('child_process');
function walk(d,a=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  const p=path.join(d,e.name);
  if(e.isDirectory())walk(p,a);
  else if(/\.(ts|tsx|js|json)\$/.test(e.name))a.push(p);
}return a;}
let bad=[];
for(const f of walk('src')){
  const disk=fs.statSync(f).size;
  let git=0;
  try{git=parseInt(cp.execSync('git show HEAD:'+f+' | wc -c',{stdio:['ignore','pipe','ignore']}).toString().trim());}catch(e){continue;}
  if(git>0&&disk<git*0.85)bad.push(f+': disk='+disk+', git='+git+' ('+Math.round(disk/git*100)+'%)');
}
if(bad.length===0)console.log('OK');else{console.log('WARN — files significantly smaller than git HEAD:');for(const b of bad)console.log('  '+b);console.log('  (May be intentional edits; investigate each.)');}
")
echo "$SIZE_RES"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ DISK INTEGRITY OK — safe to begin edit work"
  exit 0
else
  echo "❌ DISK INTEGRITY FAILED — DO NOT EDIT until repaired"
  echo ""
  echo "Repair patterns:"
  echo "  • Trailing NULs:   node -e \"const fs=require('fs');const f=process.argv[1];let b=fs.readFileSync(f);let e=b.length;while(e>0&&b[e-1]===0)e--;fs.writeFileSync(f,b.slice(0,e));\" <path>"
  echo "  • Mid-string trunc + no session edits: git show HEAD:<path> > /tmp/x && cp /tmp/x <path>"
  echo "  • Mid-string trunc + session edits:    splice — head -n N disk + tail -n +M git, where line N matches both"
  echo ""
  echo "ROOT CAUSE: FUSE write layer silently truncates large file writes via Edit/Write tool."
  echo "WORKAROUND: For files >5KB, Write to outputs/ (Windows path) then bash cp to FUSE."
  exit 1
fi
