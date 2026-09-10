# Dynamic Day — Standalone Edition

This is the exported Dynamic Day application prepared to run independently of the original Lovable/Emergent-like platform.

## What was changed

- Removed Emergent visual-editing dependency and platform scripts.
- Removed the `.emergent` platform-only directory.
- Replaced the preview API URL with a local backend URL.
- Added local environment templates.
- Added Docker Compose for a local MongoDB 8 instance.
- Added Windows/Linux one-click-ish startup scripts.
- Added PWA manifest + service worker registration for standalone browser installation and notification handling.
- Added a configurable CORS allow-list for local/cloud deployment.
- Added partial pull-forward API + UI while preserving the existing `pull_forward()` engine.
- Protected-minimum decisions remain explicit and can freeze same-day settlement until answered.
- Added English/Arabic language selection in settings and login without RTL mirroring.

## Local setup (simplest route)

1. Install Python 3.11+ and Node.js 20+.
2. Install Docker Desktop.
3. Run `docker compose up -d` from this folder to start MongoDB.
4. Copy `backend/.env.example` to `backend/.env` and set a private `JWT_SECRET` and optional admin credentials.
5. Copy `frontend/.env.example` to `frontend/.env`.
6. Start the API with `start-backend.bat` on Windows or `./start-backend.sh` on Linux/macOS.
7. Start the UI with `start-frontend.bat` or `./start-frontend.sh`.
8. Open http://localhost:3000.

The local backend is http://localhost:8000 and its API prefix is /api.

## Cloud sync / browser access

Recommended personal setup:

- Frontend: Cloudflare Pages free static hosting.
- Backend: Render free web service (personal/hobby use; free instances have limitations and are not intended as production SLAs).
- Database: MongoDB Atlas Free cluster.

For MongoDB Atlas, the Free cluster is currently free forever and limited to 512 MB storage; Atlas documents that inactive free clusters can be automatically paused after 30 days, after which they can be resumed. Choose a region close to you when creating the cluster.

For Render, the free service is suitable for hobby/personal projects but can sleep and has resource/bandwidth limitations. Do not treat it as a high-availability service.

Cloudflare Pages can host the React build as static assets on its free plan. Point the frontend environment variable `REACT_APP_BACKEND_URL` to the deployed backend URL, and set backend `CORS_ORIGINS` to the frontend URL.

## Data

The application itself uses MongoDB. Local development uses `mongodb://localhost:27017`. For multi-device sync, point `MONGO_URL` at the same MongoDB Atlas cluster used by the deployed backend.

## Notifications

The existing in-app reminder behavior is preserved. Browser permission is requested from the settings panel. The service worker is included so the site can be installed as a PWA and handle notification clicks. Truly background push delivery while the browser is fully closed requires a push subscription + server-side scheduler/provider; that is intentionally not faked by this package.

## Important

Never commit real `.env` files or passwords. Use the `.env.example` files as templates.
