#!/usr/bin/env bash
#
# play-mahjong.sh — Auto-play mahjong game loop for agents.
#
# Usage:
#   ./play-mahjong.sh <server_url> <room_id> <token> [poll_interval]
#
# Example:
#   ./play-mahjong.sh https://mahjong.agentjohn.xyz abc-123 my-token 3
#
# The script polls the game state and submits actions when it's your turn.
# It uses simple heuristics: always claim wins, pass on claims, discard
# the first tile in hand during postDraw.
#
# Runs until the game ends (phase=roundOver) or the server returns errors.

set -euo pipefail

SERVER="${1:?Usage: play-mahjong.sh <server_url> <room_id> <token> [poll_interval]}"
ROOM_ID="${2:?Missing room_id}"
TOKEN="${3:?Missing token}"
POLL_INTERVAL="${4:-3}"

API="${SERVER}/api/rooms/${ROOM_ID}"
AUTH="Authorization: Bearer ${TOKEN}"

echo "[mahjong] Starting game loop for room ${ROOM_ID}"
echo "[mahjong] Polling every ${POLL_INTERVAL}s"

CONSECUTIVE_ERRORS=0
MAX_ERRORS=20

while true; do
  # Fetch agent-friendly state
  RESP=$(curl -sf "${API}/state?format=agent" -H "${AUTH}" 2>/dev/null) || {
    CONSECUTIVE_ERRORS=$((CONSECUTIVE_ERRORS + 1))
    if [ "$CONSECUTIVE_ERRORS" -ge "$MAX_ERRORS" ]; then
      echo "[mahjong] Too many errors ($MAX_ERRORS). Game may have ended. Exiting."
      exit 0
    fi
    echo "[mahjong] Error fetching state (${CONSECUTIVE_ERRORS}/${MAX_ERRORS}). Retrying..."
    sleep "$POLL_INTERVAL"
    continue
  }
  CONSECUTIVE_ERRORS=0

  # Check if game is over
  PHASE=$(echo "$RESP" | jq -r '.phase // empty')
  if [ "$PHASE" = "roundOver" ] || [ -z "$PHASE" ]; then
    echo "[mahjong] Game over (phase=${PHASE}). Exiting."
    exit 0
  fi

  IS_MY_TURN=$(echo "$RESP" | jq -r '.isYourTurn')
  VALID_ACTIONS=$(echo "$RESP" | jq -r '.validActions // []')
  NUM_ACTIONS=$(echo "$VALID_ACTIONS" | jq 'length')

  if [ "$IS_MY_TURN" != "true" ] || [ "$NUM_ACTIONS" -eq 0 ]; then
    sleep "$POLL_INTERVAL"
    continue
  fi

  echo "[mahjong] My turn! Phase=${PHASE}, ${NUM_ACTIONS} valid actions"

  # Decision logic:
  # 1. Always declare self-win or claim win
  # 2. In claim window: pass (simple strategy)
  # 3. In postDraw: discard the first tile in hand

  ACTION=""

  # Check for win actions first
  WIN_ACTION=$(echo "$VALID_ACTIONS" | jq -c '[.[] | select(.type == "declareSelfWin" or .type == "claimWin")] | first // empty')
  if [ -n "$WIN_ACTION" ] && [ "$WIN_ACTION" != "null" ]; then
    ACTION="$WIN_ACTION"
    echo "[mahjong] Declaring win!"
  fi

  # Claim window — check for pong/kong, otherwise pass
  if [ -z "$ACTION" ] && [ "$PHASE" = "claimWindow" ]; then
    # Check for kong
    KONG_ACTION=$(echo "$VALID_ACTIONS" | jq -c '[.[] | select(.type == "claimKong")] | first // empty')
    if [ -n "$KONG_ACTION" ] && [ "$KONG_ACTION" != "null" ]; then
      ACTION="$KONG_ACTION"
      echo "[mahjong] Claiming kong!"
    else
      # Check for pong
      PONG_ACTION=$(echo "$VALID_ACTIONS" | jq -c '[.[] | select(.type == "claimPong")] | first // empty')
      if [ -n "$PONG_ACTION" ] && [ "$PONG_ACTION" != "null" ]; then
        ACTION="$PONG_ACTION"
        echo "[mahjong] Claiming pong!"
      else
        # Pass
        ACTION='{"type":"pass"}'
        echo "[mahjong] Passing claim"
      fi
    fi
  fi

  # postDraw — discard a tile
  if [ -z "$ACTION" ] && ([ "$PHASE" = "postDraw" ] || [ "$PHASE" = "discard" ]); then
    # Check for kong declaration first
    KONG_DECL=$(echo "$VALID_ACTIONS" | jq -c '[.[] | select(.type == "declareKong")] | first // empty')
    if [ -n "$KONG_DECL" ] && [ "$KONG_DECL" != "null" ]; then
      ACTION="$KONG_DECL"
      echo "[mahjong] Declaring kong!"
    else
      # Discard: pick the first discard action
      DISCARD_ACTION=$(echo "$VALID_ACTIONS" | jq -c '[.[] | select(.type == "discard")] | first // empty')
      if [ -n "$DISCARD_ACTION" ] && [ "$DISCARD_ACTION" != "null" ]; then
        TILE_NAME=$(echo "$DISCARD_ACTION" | jq -r '.tile.suit + " " + (.tile.value | tostring)')
        ACTION="$DISCARD_ACTION"
        echo "[mahjong] Discarding: ${TILE_NAME}"
      fi
    fi
  fi

  # Submit action
  if [ -n "$ACTION" ]; then
    SUBMIT_RESP=$(curl -sf -X POST "${API}/action" \
      -H "${AUTH}" \
      -H "Content-Type: application/json" \
      -d "{\"action\": ${ACTION}}" 2>/dev/null) || {
      echo "[mahjong] Failed to submit action: ${ACTION}"
    }
    echo "[mahjong] Action submitted. Response: ${SUBMIT_RESP:-error}"
  fi

  sleep 1  # Brief pause after action before next poll
done
