FROM node:20-slim

# Install Python 3 + pip
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Create Python venv and install deps
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir web3 eth-account eth-abi

# App structure: /app/state.json + /app/ai-agent/
WORKDIR /app

# Copy package files first for cached install
COPY ai-agent/package.json ai-agent/package-lock.json* ./ai-agent/
WORKDIR /app/ai-agent
RUN npm install --production

# Copy ai-agent source
WORKDIR /app
COPY ai-agent/ ./ai-agent/

# Seed state.json if not present (relayer + api_server expect ../state.json)
RUN if [ ! -f /app/state.json ]; then \
  echo '{"pools":{"lending":{"name":"Mock Lending Pool","address":"0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312","apy":550,"risk":1.2},"amm":{"name":"Mock AMM Pool","address":"0x3B084b5b2046E7651bb701d1cF729Be7Cb9fAf03","apy":1200,"risk":3}},"max_risk_limit":2,"blocks_fast_forwarded":0,"history":[]}' > /app/state.json; \
  fi

EXPOSE 3100

WORKDIR /app/ai-agent

# Run relayer in background, API server in foreground (Render health-checks the HTTP server)
CMD node relayer.js & node api_server.js
