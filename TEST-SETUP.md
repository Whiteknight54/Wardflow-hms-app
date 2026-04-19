# HMS HA Test Environment

This is the current isolated test copy of the HMS HA system. It runs separately from your main development environment and is the setup used by the smoke scripts.

## Quick Start



### 1. Start the test stack (Recommended)
#### macOS/Linux:
```bash
./start-wardflow.sh
```
This script builds and launches all containers, then opens the login page in your default browser.

#### Windows:
Double-click or run:
```bat
START-TEST.bat
```
This script builds and launches all containers, then prints the login URL for you to open in your browser.

#### Alternative: Manual Docker Compose
```bash
cd /Users/layefamezeh/Downloads/HMS-HA-TEST
docker compose -f docker-compose.test.yml up -d --build
```

### 2. Check status
```bash
docker ps | grep wardflow-test
```

You should see three containers:
- `wardflow-test-postgres` (host port `5433`)
- `wardflow-test-api` (host port `8001`)
- `wardflow-test-pgadmin` (host port `5051`)
- `wardflow-test-frontend` (host port `5500`, Nginx)

### 3. Verify the API is ready
```bash
curl http://127.0.0.1:8001/api/health
```

Expected response:
```json
{"success":true,"service":"wardflow-api"}
```

### 4. Open the frontend (Nginx container)
Open:
`http://127.0.0.1:5500/login.html`

The frontend is served by the `wardflow-test-frontend` Nginx container.
Nginx also proxies `/api/*` requests to the `api` service in the same compose network.

Optional fallback (non-container frontend):
```bash
python3 -m http.server 5500 --bind 127.0.0.1
```

### 5. Inspect the database (optional)
Open pgAdmin: `http://127.0.0.1:5051`

Login with:
- Email: `admin@wardflow.com`
- Password: `password123`

Connect to the database:
- Host: `postgres` (or `wardflow-test-postgres`)
- Database: `wardflow`
- User: `admin`
- Password: `password123`

## Login Credentials

The database is pre-seeded with test accounts:

- **Admin:** `admin@wardflow.com` / `password123`
- **Consultant:** `consultant@wardflow.com` / `password123`
- **Junior Doctor:** `jdoctor@wardflow.com` / `password123`
- **Ward Manager:** `wmanager@wardflow.com` / `password123`

## Stopping the test stack
```bash
docker compose -f docker-compose.test.yml down
```

To remove data volumes as well (clean slate):
```bash
docker compose -f docker-compose.test.yml down -v
```

## Important Notes

- **Isolation:** This test environment uses separate container names, ports, and volumes. It will not interfere with your development environment.
- **Ports:** Backend is on port **8001**, database on **5433**, pgAdmin on **5051**.
- **Frontend:** Served by Nginx on port **5500**.
- **Self-contained:** All services (postgres, api, pgadmin) start together in one compose file.
- **Data:** Test data persists in Docker volume `wardflow_test_data`. Delete it with `down -v` for a fresh start.
- **Frontend:** The app will fall back to mock data if the API is unavailable, showing a banner.

## Troubleshooting

### API shows 404 on endpoints
The schema may not have initialized. Check logs:
```bash
docker logs wardflow-test-api
docker logs wardflow-test-postgres
```

The database initializes automatically from `backend/sql/001_init.sql` when postgres starts.

### Port already in use
If ports 8001, 5433, or 5051 are in use, edit `docker-compose.test.yml` and change the host ports (left side of `:` mapping).

### Containers not starting
Check Docker daemon is running and sufficient disk/memory available.

```bash
docker system df
docker system prune -a
```

---

**This test copy is ready for isolated testing and can be safely deleted when done.**
