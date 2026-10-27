# Production Dockerfile for Pump IoT Backend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Use non-root node user for enterprise container security
USER node

EXPOSE 5000

ENV NODE_ENV=production

CMD ["node", "server.js"]
