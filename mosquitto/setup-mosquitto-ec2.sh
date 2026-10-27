#!/bin/bash
# ================================================================
#  Install and Setup Eclipse Mosquitto on Ubuntu EC2
#  Run: chmod +x setup-mosquitto-ec2.sh && sudo ./setup-mosquitto-ec2.sh
# ================================================================

set -e

echo "🚀 Installing Mosquitto MQTT Broker..."

sudo apt update
sudo apt install -y mosquitto mosquitto-clients

echo "⚙️ Configuring Mosquitto..."

# Copy petroleum-iot configuration
sudo cp mosquitto.conf /etc/mosquitto/conf.d/petroleum-iot.conf

# Set permissions
sudo chown -R mosquitto:mosquitto /var/lib/mosquitto /var/log/mosquitto

# Enable and restart service
sudo systemctl enable mosquitto
sudo systemctl restart mosquitto

echo "✅ Mosquitto Status:"
sudo systemctl status mosquitto --no-pager

echo ""
echo "🎉 Mosquitto MQTT Broker is now running on:"
echo "   - Port 1883 (Standard MQTT for IoT Hardware)"
echo "   - Port 9001 (WebSockets MQTT for Web Clients)"
echo ""
echo "⚠️ Make sure AWS EC2 Security Group allows Inbound:"
echo "   - Custom TCP Port 1883 (Source: 0.0.0.0/0 or pump IP)"
echo "   - Custom TCP Port 9001 (Source: 0.0.0.0/0)"
