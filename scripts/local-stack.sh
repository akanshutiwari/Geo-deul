#!/usr/bin/env bash
# Boots a local MagicBlock stack (base validator + ER + QFS privacy layer) with
# the Geo Duels program preloaded, plus a base-layer VRF oracle. Ctrl-C stops all.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f target/deploy/geo_duels.so ] || anchor build
PROGRAM_ID=$(solana-keygen pubkey target/deploy/geo_duels-keypair.json)
pkill -f "mb-stack --reset" 2>/dev/null || true
pkill -f "bin/vrf-oracle" 2>/dev/null || true
rm -rf test-ledger magicblock-test-storage
# --gossip-port/--dynamic-port-range keep the validator off port 8000, which
# dev servers commonly grab.
RUST_LOG=info mb-stack --reset --gossip-port 8010 --dynamic-port-range 8100-8200 \
  --bpf-program "$PROGRAM_ID" target/deploy/geo_duels.so > mb-stack.log 2>&1 &
STACK=$!
trap 'kill $STACK $VRF 2>/dev/null; pkill -f 'bin/vrf-oracle' 2>/dev/null; exit 0' INT TERM EXIT
echo "Waiting for the MagicBlock stack…"
until grep -q "MagicBlock stack is ready" mb-stack.log; do
  kill -0 $STACK 2>/dev/null || { tail -40 mb-stack.log; exit 1; }
  sleep 1
done
VRF_ORACLE_SKIP_PREFLIGHT=true RPC_URL=http://localhost:8899 WEBSOCKET_URL=ws://localhost:8900 \
  RUST_LOG=info vrf-oracle > vrf-oracle.log 2>&1 &
VRF=$!
echo "Ready: base http://localhost:8899 · QFS http://localhost:6699 · program $PROGRAM_ID"
wait $STACK
