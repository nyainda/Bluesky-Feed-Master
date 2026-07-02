# Deploy on a VPS (Self-Hosted)

This guide covers running FeedForge on your own server — a VPS, a home machine, or any Linux host. This uses the Express API server instead of Cloudflare Workers, and PostgreSQL instead of D1.

> **Note:** The Cloudflare deployment is simpler and free for most users. Use this guide only if you specifically need to self-host on your own infrastructure.

**Time to deploy: ~30–60 minutes**

---

## Architecture on a VPS

```
┌─────────────────────────────────────────┐
│          nginx (reverse proxy)           │
│   feedforge.yourdomain.com → :3000       │
│   api.feedforge.yourdomain.com → :5000   │
└──────────────┬───────────────┬──────────┘
               │               │
    ┌──────────▼──┐    ┌───────▼────────┐
    │  React SPA   │    │  Express API   │
    │ (static HTML)│    │   (port 5000)  │
    └─────────────┘    └───────┬────────┘
                               │
                     ┌─────────▼────────┐
                     │   PostgreSQL      │
                     │   (port 5432)     │
                     └──────────────────┘
```

A cron job replaces the Cloudflare cron worker — it calls the API server's `/api/admin/cron-tick` endpoint every 3 minutes.

---

## Prerequisites

- A Linux VPS with at least 512 MB RAM (1 GB recommended)
- Ubuntu 22.04 or Debian 12 (other distros work — adjust package commands)
- Root or sudo access
- A domain name pointed at your server's IP
- A Bluesky account with an App Password

---

## Step 1 — Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
npm install -g pnpm

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install nginx
sudo apt install -y nginx

# Install certbot for HTTPS
sudo apt install -y certbot python3-certbot-nginx
```

---

## Step 2 — Set Up PostgreSQL

```bash
sudo -u postgres psql <<EOF
CREATE USER feedforge WITH PASSWORD 'your-strong-password-here';
CREATE DATABASE feedforge OWNER feedforge;
GRANT ALL PRIVILEGES ON DATABASE feedforge TO feedforge;
EOF
```

---

## Step 3 — Clone and Install

```bash
cd /opt
sudo git clone https://github.com/your-username/feedforge.git
sudo chown -R $USER:$USER feedforge
cd feedforge
pnpm install
```

---

## Step 4 — Configure Environment

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
```

Edit `artifacts/api-server/.env`:

```env
PORT=5000
DATABASE_URL=postgresql://feedforge:your-strong-password-here@localhost:5432/feedforge

BLUESKY_HANDLE=yourhandle.bsky.social
BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
FEEDGEN_PUBLISHER_DID=did:plc:xxxxxxxxxxxxxxxxxxxxxxxx
FEEDGEN_HOSTNAME=api.feedforge.yourdomain.com

NODE_ENV=production
```

---

## Step 5 — Run Database Migrations

```bash
cd artifacts/api-server
pnpm run db:migrate
```

---

## Step 6 — Build the Frontend

```bash
cd artifacts/bluesky-feeds
echo "VITE_API_BASE_URL=https://api.feedforge.yourdomain.com" > .env.production
pnpm run build
# Output is in dist/
```

---

## Step 7 — Set Up systemd Services

**API Server:**

```bash
sudo tee /etc/systemd/system/feedforge-api.service > /dev/null <<EOF
[Unit]
Description=FeedForge API Server
After=network.target postgresql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/feedforge/artifacts/api-server
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/opt/feedforge/artifacts/api-server/.env
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable feedforge-api
sudo systemctl start feedforge-api
```

Check it's running:
```bash
sudo systemctl status feedforge-api
curl http://localhost:5000/api/healthz
```

---

## Step 8 — Set Up Cron Jobs

Replace the Cloudflare cron worker with system cron:

```bash
crontab -e
```

Add:
```cron
# FeedForge — main cron tick every 3 minutes
*/3 * * * * curl -s -X POST http://localhost:5000/api/admin/cron-tick > /dev/null 2>&1

# FeedForge — daily maintenance at 2 AM
0 2 * * * curl -s -X POST http://localhost:5000/api/admin/daily-maintenance > /dev/null 2>&1
```

---

## Step 9 — Configure nginx

```bash
sudo tee /etc/nginx/sites-available/feedforge > /dev/null <<'EOF'
# API
server {
    server_name api.feedforge.yourdomain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Dashboard (static files)
server {
    server_name feedforge.yourdomain.com;

    root /opt/feedforge/artifacts/bluesky-feeds/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/feedforge /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Step 10 — HTTPS with Let's Encrypt

```bash
sudo certbot --nginx -d feedforge.yourdomain.com -d api.feedforge.yourdomain.com
```

Certbot automatically updates the nginx config and sets up auto-renewal.

---

## Step 11 — Build the API Server for Production

```bash
cd /opt/feedforge/artifacts/api-server
pnpm run build
sudo systemctl restart feedforge-api
```

---

## Updating

```bash
cd /opt/feedforge
git pull
pnpm install

# Rebuild API
cd artifacts/api-server
pnpm run build

# Run any new migrations
pnpm run db:migrate

# Rebuild frontend
cd ../bluesky-feeds
pnpm run build

# Restart
sudo systemctl restart feedforge-api
```

---

## Firewall

Only expose necessary ports:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

PostgreSQL (port 5432) should only be accessible locally — do not expose it publicly.

---

## Troubleshooting

**API server not starting**
```bash
sudo journalctl -u feedforge-api -f
```

**Database connection refused**
- Check PostgreSQL is running: `sudo systemctl status postgresql`
- Verify `DATABASE_URL` in `.env` matches your PostgreSQL credentials

**Cron not running**
```bash
# Check cron logs
sudo grep CRON /var/log/syslog | tail -20

# Test the endpoint manually
curl -X POST http://localhost:5000/api/admin/cron-tick
```

**HTTPS not working**
- Ensure your domain DNS is pointing to your server IP before running certbot
- Check nginx logs: `sudo tail -f /var/log/nginx/error.log`
