# Dynamic Day — Zero-Cost Personal Deployment Guide

This guide assumes a personal/hobby deployment. The recommended stack keeps your existing MongoDB-based backend and React frontend.

## Recommended architecture

Browser/PWA
→ Cloudflare Pages (frontend)
→ Render Web Service (FastAPI backend)
→ MongoDB Atlas Free (database)

For background browser notifications:
Cloudflare Worker Cron (every minute)
→ POST /api/push/dispatch-due
→ FastAPI
→ Web Push browser services

No paid service is required for this architecture, but free tiers have limits and are not an uptime guarantee.

## A. Local first

1. Install Docker Desktop.
2. Install Python 3.11+ and Node.js 20+.
3. From the project root run:

```bash
docker compose up -d
```

4. Copy `backend/.env.example` to `backend/.env`.
5. Generate a strong JWT secret. The app can run without `ADMIN_EMAIL` / `ADMIN_PASSWORD`; when both are present, startup ensures that account exists.
6. Copy `frontend/.env.example` to `frontend/.env`.
7. On Windows run `start-backend.bat` and `start-frontend.bat`. On Linux/macOS run `./start-backend.sh` and `./start-frontend.sh`.
8. Open `http://localhost:3000`.

## B. Database sync across devices

Create a MongoDB Atlas Free cluster and use its connection string as `MONGO_URL` on the deployed backend.

Set:

```text
DB_NAME=dynamic_day
CORS_ORIGINS=https://YOUR-FRONTEND-DOMAIN
JWT_SECRET=LONG_RANDOM_SECRET
```

The free Atlas cluster is intended for small-scale use and currently provides 512 MB of storage. MongoDB documents that Free clusters never expire, but inactive Free clusters can be automatically paused after 30 days; they can be resumed. Keep regular backups.

## C. Backend deployment

Push this repository to GitHub.

In Render, create the Blueprint from `render.yaml`. It creates a Python web service for the API and a static site for the React frontend. The API must receive:

```text
MONGO_URL=<Atlas connection string>
DB_NAME=dynamic_day
CORS_ORIGINS=<frontend URL, comma-separated if needed>
JWT_SECRET=<random secret>
```

For the first deployment, you can leave `ADMIN_EMAIL` and `ADMIN_PASSWORD` unset and use the normal registration screen.

## D. Frontend deployment

The React app reads `REACT_APP_BACKEND_URL` at build time.

Set it to the public Render API URL, without a trailing `/api` because the application adds that prefix itself.

Example:

```text
REACT_APP_BACKEND_URL=https://YOUR-API.onrender.com
```

The included Render Blueprint already builds the frontend from `frontend/` and rewrites SPA routes to `/index.html`.

You can instead deploy the `frontend/build` folder to Cloudflare Pages.

## E. Browser notifications

Normal in-app reminders work without extra infrastructure.

For actual Web Push while the browser/app is not the active tab, configure VAPID:

```text
VAPID_PRIVATE_KEY=<PEM private key>
VAPID_PUBLIC_KEY=<base64url public key>
VAPID_CLAIMS_EMAIL=mailto:you@example.com
PUSH_CRON_SECRET=<random secret>
```

Generate a key pair with:

```bash
python tools/generate_vapid.py
```

Then deploy the `push-scheduler` Worker with Cloudflare Wrangler and configure its two secrets:

```bash
wrangler secret put BACKEND_URL
wrangler secret put PUSH_CRON_SECRET
```

The Worker uses a one-minute Cron Trigger. Cron Triggers execute on UTC; the backend converts the current time to each subscribed browser's timezone before checking the day's blocks.

## F. Backup

For MongoDB Atlas:

```bash
export MONGO_URL='your-connection-string'
./tools/backup_mongodb.sh
```

On Windows, use `tools/backup_mongodb.bat` from a shell where `MONGO_URL` is set and `mongodump` is installed.

## G. What is intentionally not platform-dependent anymore

The runtime no longer requires:

- Emergent visual editing
- Emergent preview URLs
- Emergent page scripts
- Emergent analytics bootstrap
- Emergent cron directory

The scheduling engine, API, authentication, MongoDB model, undo, focus mode, reminders, and frontend remain in the application itself.

## H. Important free-tier reality

Free hosting is practical for personal use but cannot honestly be called guaranteed 24/7 infrastructure. Render free compute has resource/sleep limitations. MongoDB Atlas Free can pause after prolonged inactivity. Cloudflare Workers Free has request/CPU quotas. Keep a local copy and database backups.
