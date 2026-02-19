#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Blue/Green zero-downtime deploy for x402-gateway
#
# Strategy:
#   - Two ports (3402 and 3403) alternate as active/standby
#   - State persisted in /opt/x402-gateway/.active-port
#   - Caddy admin API (localhost:2019) used to swap upstreams live
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="/opt/x402-gateway"
STATE_FILE="$REPO_DIR/.active-port"
CADDY_ADMIN="http://localhost:2019"
HEALTH_TIMEOUT=60
IMAGE_PREFIX="gateway"
CONTAINER_NAME_A="x402-gateway-a"
CONTAINER_NAME_B="x402-gateway-b"
PORT_A=3402
PORT_B=3403

# ── Read current state ────────────────────────────────────────────────────────
if [[ -f "$STATE_FILE" ]]; then
  ACTIVE_PORT=$(cat "$STATE_FILE")
else
  ACTIVE_PORT=$PORT_A
fi

if [[ "$ACTIVE_PORT" -eq "$PORT_A" ]]; then
  NEW_PORT=$PORT_B
  ACTIVE_CONTAINER=$CONTAINER_NAME_A
  NEW_CONTAINER=$CONTAINER_NAME_B
else
  NEW_PORT=$PORT_A
  ACTIVE_CONTAINER=$CONTAINER_NAME_B
  NEW_CONTAINER=$CONTAINER_NAME_A
fi

echo "==> [deploy] Active port: $ACTIVE_PORT  →  New port: $NEW_PORT"

# ── 1. Pull latest code ───────────────────────────────────────────────────────
echo "==> [deploy] Pulling latest code..."
cd "$REPO_DIR"
git pull origin "$(git rev-parse --abbrev-ref HEAD)"

# ── 2. Build new image tagged with git SHA ────────────────────────────────────
GIT_SHA=$(git rev-parse --short HEAD)
NEW_IMAGE="$IMAGE_PREFIX:$GIT_SHA"

echo "==> [deploy] Building image $NEW_IMAGE..."
docker build -t "$NEW_IMAGE" .

# ── 3. Start new container on alternate port ──────────────────────────────────
echo "==> [deploy] Starting new container $NEW_CONTAINER on port $NEW_PORT..."

# Stop any stale container on this port
docker rm -f "$NEW_CONTAINER" 2>/dev/null || true

docker run -d \
  --name "$NEW_CONTAINER" \
  --env-file "$REPO_DIR/.env" \
  -v "$REPO_DIR/cdp_key.pem:/app/cdp_key.pem:ro" \
  -v "x402-gateway_gateway_data:/app/data" \
  -p "127.0.0.1:$NEW_PORT:3402" \
  --restart unless-stopped \
  "$NEW_IMAGE"

# ── 4. Health check new container ─────────────────────────────────────────────
echo "==> [deploy] Health checking http://localhost:$NEW_PORT/health (max ${HEALTH_TIMEOUT}s)..."

ELAPSED=0
until curl -sf "http://localhost:$NEW_PORT/health" > /dev/null 2>&1; do
  if [[ $ELAPSED -ge $HEALTH_TIMEOUT ]]; then
    echo "✗ [deploy] Health check timed out after ${HEALTH_TIMEOUT}s — aborting."
    echo "  New container logs:"
    docker logs --tail 50 "$NEW_CONTAINER"
    docker rm -f "$NEW_CONTAINER"
    exit 1
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

echo "✓ [deploy] Health check passed in ${ELAPSED}s."

# ── 5. Update Caddy upstream via admin API ────────────────────────────────────
echo "==> [deploy] Updating Caddy upstream to localhost:$NEW_PORT..."

# Fetch current Caddy config, update the upstream dial address, and reload.
# This uses Python to safely parse+patch the JSON config.
python3 - <<PYEOF
import json, sys, urllib.request, urllib.error

admin = "$CADDY_ADMIN"
new_addr = "localhost:$NEW_PORT"

def caddy_get(path):
    try:
        with urllib.request.urlopen(admin + path) as r:
            return json.loads(r.read())
    except urllib.error.URLError as e:
        print(f"ERROR: Cannot reach Caddy admin API at {admin}: {e}", file=sys.stderr)
        sys.exit(1)

def caddy_patch(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(admin + path, data=body, method="PATCH",
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        print(f"ERROR: Caddy PATCH failed {e.code}: {e.read()}", file=sys.stderr)
        sys.exit(1)

def caddy_load(cfg):
    body = json.dumps(cfg).encode()
    req = urllib.request.Request(admin + "/load", data=body, method="POST",
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        print(f"ERROR: Caddy load failed {e.code}: {e.read()}", file=sys.stderr)
        sys.exit(1)

cfg = caddy_get("/config/")

# Walk the config and replace all upstream dial addresses that point to
# the old port with the new port.
old_addr = "localhost:$ACTIVE_PORT"

def patch_upstreams(obj):
    if isinstance(obj, dict):
        if obj.get("handler") == "reverse_proxy":
            upstreams = obj.get("upstreams", [])
            for u in upstreams:
                if u.get("dial") == old_addr:
                    u["dial"] = new_addr
                    print(f"  Patched upstream: {old_addr} → {new_addr}")
        for v in obj.values():
            patch_upstreams(v)
    elif isinstance(obj, list):
        for item in obj:
            patch_upstreams(item)

patch_upstreams(cfg)
status = caddy_load(cfg)
print(f"  Caddy reload status: {status}")
PYEOF

echo "✓ [deploy] Caddy updated."

# ── 6. Graceful stop old container ───────────────────────────────────────────
echo "==> [deploy] Stopping old container $ACTIVE_CONTAINER (10s grace)..."
docker stop --time 10 "$ACTIVE_CONTAINER" 2>/dev/null || true
docker rm "$ACTIVE_CONTAINER" 2>/dev/null || true
echo "✓ [deploy] Old container stopped."

# ── 7. Clean up old images ────────────────────────────────────────────────────
echo "==> [deploy] Pruning dangling images..."
docker image prune -f

# ── Save state ─────────────────────────────────────────────────────────────────
echo "$NEW_PORT" > "$STATE_FILE"
echo "$ACTIVE_PORT" > "$REPO_DIR/.previous-port"
echo "$ACTIVE_CONTAINER" > "$REPO_DIR/.previous-container"

echo ""
echo "✓ [deploy] Deploy complete!"
echo "  Active:   $NEW_CONTAINER (port $NEW_PORT, image $NEW_IMAGE)"
echo "  Previous: $ACTIVE_CONTAINER (port $ACTIVE_PORT) — stopped"
