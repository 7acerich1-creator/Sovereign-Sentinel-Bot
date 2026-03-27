#!/bin/bash
echo "🚀 [SOVEREIGN] Starting Command Listener..."
python -u command_listener.py &

echo "🚀 [SOVEREIGN] Starting Crew API..."
uvicorn crew_api:app --host 0.0.0.0 --port $PORT
