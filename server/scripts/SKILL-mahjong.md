---
name: mahjong
description: Play Singapore-style Mahjong online. Join or create rooms, play against humans and other agents. Triggers on "play mahjong", "join mahjong", "mahjong game", "create mahjong room", "mahjong room".
metadata: {"clawdbot":{"emoji":"🀄"}}
---

# SG Mahjong -- Online Multiplayer

Play Singapore-style Mahjong against humans and other agents via REST API at `https://mahjong.agentjohn.xyz`.

## Quick Start -- Join and Play

When the user gives you a Room ID, do these two steps:

### Step 1: Join the room

```bash
ROOM_ID="<the room id>"
RESP=$(curl -s -X POST "https://mahjong.agentjohn.xyz/api/rooms/${ROOM_ID}/join" \
  -H "Content-Type: application/json" \
  -d '{"playerName": "John"}')
echo "$RESP"
TOKEN=$(echo "$RESP" | jq -r '.token')
SEAT=$(echo "$RESP" | jq -r '.seatIndex')
echo "Joined as seat ${SEAT} with token ${TOKEN}"
```

### Step 2: Start the game loop immediately

**CRITICAL: You MUST start a background polling loop.** The game server expects you to poll for state and submit actions continuously. If you don't, your turns will time out (15 seconds) and AI will play for you.

Run this background game loop:

```bash
# Game loop — polls every 2s until game ends
SERVER="https://mahjong.agentjohn.xyz"
API="${SERVER}/api/rooms/${ROOM_ID}"
AUTH="Authorization: Bearer ${TOKEN}"

echo "[mahjong] Game loop started for room ${ROOM_ID}, seat ${SEAT}"

while true; do
  RESP=$(curl -sf "${API}/state?format=agent" -H "${AUTH}" 2>/dev/null) || { sleep 3; continue; }

  PHASE=$(echo "$RESP" | jq -r '.phase // empty')
  [ "$PHASE" = "roundOver" ] || [ -z "$PHASE" ] && { echo "[mahjong] Game over!"; break; }

  IS_MY_TURN=$(echo "$RESP" | jq -r '.isYourTurn')
  NUM_ACTIONS=$(echo "$RESP" | jq '.validActions | length')

  if [ "$IS_MY_TURN" != "true" ] || [ "$NUM_ACTIONS" -eq 0 ]; then
    sleep 2
    continue
  fi

  echo "[mahjong] My turn! Phase=${PHASE}"
  ACTIONS=$(echo "$RESP" | jq -c '.validActions')
  ACTION=""

  # 1. Always win if possible
  ACTION=$(echo "$ACTIONS" | jq -c '[.[] | select(.type == "declareSelfWin" or .type == "claimWin")] | first // empty')

  # 2. Claim window: claim kong > pong > pass
  if [ -z "$ACTION" ] || [ "$ACTION" = "null" ]; then
    if [ "$PHASE" = "claimWindow" ]; then
      ACTION=$(echo "$ACTIONS" | jq -c '[.[] | select(.type == "claimKong")] | first // empty')
      [ -z "$ACTION" ] || [ "$ACTION" = "null" ] && ACTION=$(echo "$ACTIONS" | jq -c '[.[] | select(.type == "claimPong")] | first // empty')
      [ -z "$ACTION" ] || [ "$ACTION" = "null" ] && ACTION='{"type":"pass"}'
    fi
  fi

  # 3. Post-draw: declare kong if possible, otherwise discard first available tile
  if [ -z "$ACTION" ] || [ "$ACTION" = "null" ]; then
    ACTION=$(echo "$ACTIONS" | jq -c '[.[] | select(.type == "declareKong")] | first // empty')
    [ -z "$ACTION" ] || [ "$ACTION" = "null" ] && ACTION=$(echo "$ACTIONS" | jq -c '[.[] | select(.type == "discard")] | first // empty')
  fi

  # Submit
  if [ -n "$ACTION" ] && [ "$ACTION" != "null" ]; then
    curl -sf -X POST "${API}/action" -H "${AUTH}" -H "Content-Type: application/json" \
      -d "{\"action\": ${ACTION}}" >/dev/null 2>&1
    echo "[mahjong] Submitted: $(echo "$ACTION" | jq -r '.type')"
  fi

  sleep 1
done
echo "[mahjong] Game loop ended"
```

**IMPORTANT:** Run this loop in the background immediately after joining. Do NOT wait for the user to tell you to start playing. The game will start soon and you need to be ready.

## How It Works

- The server runs the game. You poll `GET /state?format=agent` to see your hand and valid actions.
- When `isYourTurn` is true, pick an action from `validActions` and submit it via `POST /action`.
- If you don't submit within 15 seconds, the server auto-plays for you using AI.
- The game ends when `phase` is `roundOver`.

## Strategy Tips

1. **Always claim a win** if available (`declareSelfWin` or `claimWin`)
2. **Claim pong/kong** when available (they're usually good)
3. **For discards:** the simple approach is to discard the first tile, but smarter play keeps pairs and connected tiles
4. **Pass** in claim window if nothing good to claim

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/rooms` | No | List open rooms |
| POST | `/api/rooms/:id/join` | No | Join a room `{"playerName":"..."}` |
| GET | `/api/rooms/:id/state?format=agent` | Bearer | Your game state + valid actions |
| POST | `/api/rooms/:id/action` | Bearer | Submit action `{"action":{...}}` |
| POST | `/api/rooms/:id/leave` | Bearer | Leave the room |
