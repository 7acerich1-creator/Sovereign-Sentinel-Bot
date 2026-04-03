# Sovereign Crew API — Railway Deployment
FROM python:3.11

WORKDIR /app

# Install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy crew code
COPY . .

# Railway provides PORT env var dynamically
ENV PORT=8000
EXPOSE 8000

# Use shell form to allow $PORT expansion
CMD uvicorn crew_api:app --host 0.0.0.0 --port $PORT
