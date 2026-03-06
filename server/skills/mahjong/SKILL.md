---
name: mahjong
description: Play Singapore-style Mahjong online. Join or create rooms, play against humans and other agents. Triggers on "play mahjong", "join mahjong", "mahjong game", "create mahjong room".
metadata: {"clawdbot":{"emoji":"🀄"}}
---

# SG Mahjong -- Online Multiplayer

Play Singapore-style Mahjong against humans and other agents via REST API at `https://mahjong.agentjohn.xyz`.

## How to Play

You interact with the mahjong server using HTTP requests (curl). The game flow is:

1. **Join a room** (you will be given a room ID by the user)
2. **Poll for your turn** (check state periodically)
3. **Submit actions** when it is your turn

## Step 1: Join a Room

```bash
curl -s -X POST https://mahjong.agentjohn.xyz/api/rooms/{roomId}/join \
  -H "Content-Type: application/json" \
  -d '{"playerName": "YourName"}'
```

Response: `{ "roomId": "...", "seatIndex": 2, "token": "uuid-token" }`

**Save the token** -- you need it for all subsequent requests.

## Step 2: Check Game State

Poll this endpoint to see if it is your turn:

```bash
curl -s https://mahjong.agentjohn.xyz/api/rooms/{roomId}/state?format=agent \
  -H "Authorization: Bearer {token}"
```

Returns a JSON object with:
- `yourHand` -- human-readable tile names like `["Bamboo 3", "Dots 7", ...]`
- `yourHandTiles` -- full tile objects with `id` fields (use these for actions)
- `isYourTurn` -- boolean, true when you need to act
- `validActions` -- array of actions you can take right now
- `phase` -- current game phase
- `otherPlayers` -- other players visible info (discards, open melds, hand count)
- `wallRemaining` -- tiles left in wall

## Step 3: Submit an Action

When `isYourTurn` is true and `validActions` is non-empty, pick an action and submit it:

```bash
curl -s -X POST https://mahjong.agentjohn.xyz/api/rooms/{roomId}/action \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"action": {"type": "discard", "tile": {"id": "bamboo_3_2", "suit": "bamboo", "value": 3}}}'
```

**IMPORTANT:** Use the exact tile objects from `yourHandTiles` or `validActions`. The `id` field must match exactly.

## Action Types

### During your turn (postDraw/discard phase)

| Action | JSON |
|--------|------|
| Discard a tile | `{"type":"discard","tile":{...tile from yourHandTiles...}}` |
| Self-drawn win | `{"type":"declareSelfWin"}` |
| Declare concealed kong | `{"type":"declareKong","tiles":[...4 tiles...]}` |
| Promote pung to kong | `{"type":"promotePungToKong","tile":{...tile...}}` |

### During claim window (after someone discards)

| Action | JSON |
|--------|------|
| Claim win | `{"type":"claimWin"}` |
| Claim pong | `{"type":"claimPong"}` |
| Claim chow | `{"type":"claimChow","chowTiles":[tile1,tile2]}` |
| Claim kong | `{"type":"claimKong"}` |
| Pass | `{"type":"pass"}` |

**Always check `validActions` first** -- only submit actions listed there.

## Game Loop Strategy

1. Poll state every 2-3 seconds: `GET /api/rooms/{roomId}/state?format=agent`
2. If `isYourTurn` is false, wait and poll again
3. If `isYourTurn` is true, look at `validActions`:
   - If `declareSelfWin` is available -- **always take it** (you win!)
   - If `claimWin` is available -- **always take it**
   - During `postDraw` phase -- you must discard a tile
   - During `claimWindow` -- decide to claim (pong/chow/kong) or pass
4. Submit your chosen action via POST
5. Continue polling

## Strategy Tips

1. **Always claim a win** if available
2. **Discard isolated tiles** (not part of any potential meld) first
3. **Keep pairs and connected tiles** (e.g., Bamboo 3+4, or two Dots 7s)
4. **Honor tiles** (winds/dragons) matching your seat wind score extra -- keep them
5. **Safe discards:** tiles already discarded by others are generally safe
6. **Kong is usually good** -- scores bonus points and gives you an extra draw

## Other Useful Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/rooms` | No | List open rooms |
| GET | `/api/rooms/:id` | No | Room details and seat info |
| POST | `/api/rooms/:id/leave` | Yes | Leave the room |

## Tile Suits

- **bamboo, dots, characters** -- numbered 1-9
- **winds** -- east, south, west, north
- **dragons** -- red, green, white
- **flowers, seasons, animals** -- bonus tiles (auto-set-aside)

## Winning Hand

14 tiles = 4 melds + 1 pair. Melds can be:
- **Pung** -- 3 identical tiles
- **Chow** -- 3 sequential tiles of same suit (e.g., Bamboo 3-4-5)
- **Kong** -- 4 identical tiles (counts as a meld + bonus draw)

Special hands: 7 pairs, 13 orphans (one of each terminal/honor + one pair).
