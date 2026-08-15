#!/bin/sh
# Declare and deploy SealedAuction to Starknet Sepolia.
#
#   sh scripts/deploy-sepolia.sh
#
# Needs an sncast account named by ACCOUNT below, already deployed and funded.
# Create one with:
#   sncast account create --name sealed-deployer --network sepolia
#   (fund the printed address from a Sepolia STRK faucet)
#   sncast account deploy --network sepolia --name sealed-deployer
#
# The seller secret is read from the environment and never written to disk by
# this script. Losing it means the proceeds cannot be claimed.
set -eu

ACCOUNT="${SEALED_ACCOUNT:-sealed-deployer}"
NETWORK="${SEALED_NETWORK:-sepolia}"

# STRK, same address on Sepolia and mainnet.
TOKEN="${SEALED_TOKEN:-0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d}"
# STRK20 privacy pool v2.0 on Sepolia. The only address allowed to call
# privacy_invoke, checked in the constructor's stored `pool`.
POOL="${SEALED_POOL:-0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91}"

# Gate defaults: small amounts, short windows, so a full lifecycle fits in one
# sitting. u256 values are passed low limb first, high limb second.
RESERVE_LOW="${SEALED_RESERVE_LOW:-100000000000000000}"     # 0.1 STRK
COLLATERAL_LOW="${SEALED_COLLATERAL_LOW:-1000000000000000000}" # 1 STRK

NOW=$(date +%s)
CLOSE="${SEALED_CLOSE:-$((NOW + 3600))}"      # bidding open 1 hour
DEADLINE="${SEALED_DEADLINE:-$((NOW + 7200))}" # reveal window 1 hour after that

if [ -z "${SEALED_SELLER_HANDLE:-}" ]; then
  echo "SEALED_SELLER_HANDLE is not set." >&2
  echo "" >&2
  echo "It is poseidon(seller_secret, seller_payout_address). Generate it with" >&2
  echo "the same code the frontend uses, so the seller can actually claim:" >&2
  echo "  cd web && npx tsx scripts/seller-handle.ts <payout_address>" >&2
  exit 1
fi

echo "Declaring SealedAuction on $NETWORK as $ACCOUNT"
DECLARE_OUT=$(cd contracts && sncast --account "$ACCOUNT" declare \
  --network "$NETWORK" --contract-name SealedAuction 2>&1) || true
echo "$DECLARE_OUT"

CLASS_HASH=$(printf '%s\n' "$DECLARE_OUT" | sed -n 's/.*[Cc]lass [Hh]ash: *\(0x[0-9a-fA-F]*\).*/\1/p' | head -1)
if [ -z "$CLASS_HASH" ]; then
  # Already declared is not an error. Pull the hash out of the message.
  CLASS_HASH=$(printf '%s\n' "$DECLARE_OUT" | sed -n 's/.*\(0x[0-9a-fA-F]\{60,\}\).*/\1/p' | head -1)
fi
[ -n "$CLASS_HASH" ] || { echo "Could not determine class hash." >&2; exit 1; }
echo "class hash: $CLASS_HASH"

echo "Deploying"
sncast --account "$ACCOUNT" deploy \
  --network "$NETWORK" \
  --class-hash "$CLASS_HASH" \
  --constructor-calldata \
    "$SEALED_SELLER_HANDLE" \
    "$TOKEN" \
    "$POOL" \
    "$RESERVE_LOW" 0 \
    "$COLLATERAL_LOW" 0 \
    "$CLOSE" \
    "$DEADLINE"

echo ""
echo "close_time    $CLOSE"
echo "reveal_deadline $DEADLINE"
echo "Record the deployed address and transaction hash in strk20.json."
