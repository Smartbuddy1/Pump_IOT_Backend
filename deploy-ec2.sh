#!/bin/bash
# ================================================================
#  AWS EC2 - DEPLOYMENT SCRIPT
#  File: /home/ubuntu/deploy.sh
#  Run: chmod +x deploy.sh && ./deploy.sh
# ================================================================

set -e  # किसी error वर script बंद होईल

echo "🚀 Petroleum IoT - EC2 Deployment सुरू..."

PROJECT_DIR="/home/ubuntu/petroleum-iot"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

# ── Step 1: Node.js & npm version check ──────────────────────────
echo "📦 Node version: $(node -v)"
echo "📦 npm version: $(npm -v)"

# ── Step 2: Backend Setup ─────────────────────────────────────────
echo ""
echo "⚙️  Backend setup..."
cd "$BACKEND_DIR"
npm install --production

# .env.production → .env copy करा
cp .env.production .env

# Check Mosquitto MQTT Broker service
if systemctl is-active --quiet mosquitto; then
    echo "✅ Mosquitto MQTT Broker is running on port 1883"
else
    echo "⚠️ Mosquitto not running. Attempting to restart..."
    sudo systemctl restart mosquitto || true
fi

# PM2 ने backend start/restart करा
if pm2 list | grep -q "petroleum-backend"; then
    pm2 restart petroleum-backend
else
    pm2 start server.js --name petroleum-backend
fi
echo "✅ Backend running on port 5000"

# ── Step 3: Frontend Build ────────────────────────────────────────
echo ""
echo "🏗️  Frontend build..."
cd "$FRONTEND_DIR"
npm install
npm run build  # हे .env.production automatically वापरतो

# Create symlink so Nginx /p2t/ subpath directly resolves all static assets
ln -sfn . "$FRONTEND_DIR/dist/p2t"

echo "✅ Frontend build complete → dist/ folder ready"

# ── Step 4: Nginx reload ──────────────────────────────────────────
sudo systemctl reload nginx
echo "✅ Nginx reloaded"

# ── Step 5: PM2 save ─────────────────────────────────────────────
pm2 save
echo "✅ PM2 startup config saved"

echo ""
echo "🎉 Deployment Complete!"
echo "   Frontend: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
echo "   Backend API: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)/api/v1"
