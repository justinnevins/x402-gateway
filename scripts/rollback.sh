#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Rollback: swap Caddy back to the previous container.
#
# This script re-activates the last stopped container and swaps Caddy's
# upstream back to it. The current container is stopped gracefully.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="/opt/x402-gateway"
STATE_FILE="$REPO_DIR/.active-port"
PREV_PORT_FILE="$REPO_DIR/.previous-port"
PREV_CONTAINER_FILE="$REPO_DIR/.previous-container"
CADDY_ADMIN="http://localhost:2019"
IMAGE_PREFIX="gateway"
CONTAINER_NAME_A="x402-gateway-a"
CONTAINER_NAME_B="x402-gateway-b"
PORT_A=3402
PORT_B=3403

# ── Check state ───────────────────────────────────────────────────────────────
if [[ ! -f "$PREV_PORT_FILE" ]] || [[ ! -f "$PREV_CONTAINER_FILE" ]]; then
  echo "✗ [rollback] No previous deployment state found. Cannot roll back."
  exit 1
fi

ACTIVE_PORT=$(cat "$STATE_FILE")
PREV_PORT=$(cat "$PREV_PORT_FILE")
PREV_CONTAINER=$(cat "$PREV_CONTAINER_FILE")

if [[ "$ACTIVE_PORT" -eq "$PORT_A" ]]; then
  ACTIVE_CONTAINER=$CONTAINER_NAME_A
else
  ACTIVE_CONTAINER=$CONTAINER_NAME_B
fi

echo "==> [rollback] Rolling back:"
echo "    Current:  $ACTIVE_CONTAINER (port $ACTIVE_PORT)"
echo "    Previous: $PREV_CONTAINER   (port $PREV_PORT)"

# ── Restart previous container if not running ─────────────────────────────────
if ! docker ps --filter "name=$PREV_CONTAINER" --filter "status=running" --format '{{.Names}}' | grep -q "$PREV_CONTAINER"; then
  echo "==> [rollback] Previous container not running — attempting restart..."
  if docker ps -a --format '{{.Names}}' | grep -q "$PREV_CONTAINER"; then
    docker start "$PREV_CONTAINER"
  else
    echo "✗ [rollback] Previous container $PREV_CONTAINER not found."
    echo "  You may need to rebuild and restart manually."
    exit 1
  fi
fi

# Wait for it to be healthy
echo "==> [rollback] Waiting for http://localhost:$PREV_PORT/health..."
ELAPSED=0
until curl -sf "http://localhost:$PREV_PORT/health" > /dev/null 2>&1; do
  if [[ $ELAPSED -ge 30 ]]; then
    echo "✗ [rollback] Health check timed out after 30s — aborting."
    exit 1
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done
echo "✓ [rollback] Previous container healthy."

# ── Swap Caddy back ───────────────────────────────────────────────────────────
echo "==> [rollback] Swapping Caddy upstream back to localhost:$PREV_PORT..."

python3 - <<PYEOF
import json, sys, urllib.request, urllib.error

admin = "$CADDY_ADMIN"
new_addr  = "localhost:$PREV_PORT"
old_addr  = "localhost:$ACTIVE_PORT"

def caddy_get(path):
    try:
        with urllib.request.urlopen(admin + path) as r:
            return json.loads(r.read())
    except urllib.error.URLError as e:
        print(f"ERROR: Cannot reach Caddy admin API: {e}", file=sys.stderr)
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

def patch_upstreams(obj):
    if isinstance(obj, dict):
        if obj.get("handler") == "reverse_proxy":
            for u in obj.get("upstreams", []):
                if u.get("dial") == old_addr:
                    u["dial"] = new_addr
                    print(f"  Patched upstream: {old_addr} → {new_addr}")
        for v in obj.values():
            patch_upstreams(v)
    elif isinstance(obj, list):
        for item in obj:
            patch_upstreams(item)

patch_upstreams(cfg)
caddy_load(cfg)
print("  Caddy upstream restored.")
PYEOF

echo "✓ [rollback] Caddy updated."

# ── Stop the current (bad) container ─────────────────────────────────────────
echo "==> [rollback] Stopping current container $ACTIVE_CONTAINER..."
docker stop --time 10 "$ACTIVE_CONTAINER" 2>/dev/null || true
echo "✓ [rollback] Current container stopped."

# ── Update state files ────────────────────────────────────────────────────────
echo "$PREV_PORT" > "$STATE_FILE"
rm -f "$PREV_PORT_FILE" "$PREV_CONTAINER_FILE"

echo ""
echo "✓ [rollback] Rollback complete!"
echo "  Active container: $PREV_CONTAINER (port $PREV_PORT)"
