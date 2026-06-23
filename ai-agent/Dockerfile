FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir web3 eth-account eth-abi

WORKDIR /app

COPY ai-agent/package.json ai-agent/package-lock.json* ./ai-agent/
WORKDIR /app/ai-agent
RUN npm install --production

WORKDIR /app
COPY ai-agent/ ./ai-agent/

COPY deployments.json ./deployments.json

EXPOSE 3100

WORKDIR /app/ai-agent
CMD ["node", "runner.js"]
