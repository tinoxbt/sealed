#!/bin/sh
# Declare and deploy SealedAuction to Starknet MAINNET.
#
#   SEALED_SELLER_HANDLE=0x... sh scripts/deploy-mainnet.sh
#
# This spends real money and cannot be undone. Read docs/MAINNET.md first.
#
# Addresses below were verified against mainnet on 16 August 2026, by calling
# the contracts rather than by copying a link:
#   pool  get_screener_public_key -> 0x501cc452...ef88fdb2   (a real STRK20 pool)
#   token symbol                  -> "STRK"
set -eu

ACCOUNT="${SEALED_ACCOUNT:-sealed-mainnet}"

# STRK. Same address on Sepolia and mainnet.
TOKEN="${SEALED_TOKEN:-0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d}"
# Canonical STRK20 privacy pool on mainnet. The only address permitted to call
# privacy_invoke, enforced by the constructor's stored `pool`.
POOL="${SEALED_POOL:-0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a}"

# Deliberately small. This is a demonstration auction with real money in it, and
# the collateral caps every bid, so it also caps what anyone can lose.
RESERVE_LOW="${SEALED_RESERVE_LOW:-100000000000000000}"      # 0.1 STRK
COLLATERAL_LOW="${SEALED_COLLATERAL_LOW:-1000000000000000000}" # 1 STRK

NOW=$(date +%s)
# Long enough that judges can bid without racing a clock, and the reveal window
# closes well before the sprint deadline.
CLOSE="${SEALED_CLOSE:-$((NOW + 432000))}"      # 5 days
DEADLINE="${SEALED_DEADLINE:-$((NOW + 518400))}" # 1 day to reveal

if [ -z "${SEALED_SELLER_HANDLE:-}" ]; then
  echo "SEALED_SELLER_HANDLE is not set." >&2
  echo "" >&2
  echo "Generate it, and SAVE THE SECRET SOMEWHERE YOU WILL NOT LOSE IT:" >&2
  echo "  cd web && npx tsx scripts/seller-handle.ts 0x<mainnet_payout_address>" >&2
  echo "" >&2
  echo "Without the secret the proceeds are unclaimable by anyone, forever." >&2
  exit 1
fi

echo "MAINNET. Real funds."
echo "  account      $ACCOUNT"
echo "  collateral   $COLLATERAL_LOW wei"
echo "  reserve      $RESERVE_LOW wei"
echo "  closes       $(date -r "$CLOSE" 2>/dev/null || date -d "@$CLOSE")"
echo "  reveal until $(date -r "$DEADLINE" 2>/dev/null || date -d "@$DEADLINE")"
echo ""
printf "Type MAINNET to continue: "
read -r confirm
[ "$confirm" = "MAINNET" ] || { echo "Aborted."; exit 1; }

echo "Declaring"
DECLARE_OUT=$(cd contracts && sncast --wait --account "$ACCOUNT" declare \
  --network mainnet --contract-name SealedAuction 2>&1) || true
echo "$DECLARE_OUT"

CLASS_HASH=$(printf '%s\n' "$DECLARE_OUT" | sed -n 's/.*[Cc]lass [Hh]ash: *\(0x[0-9a-fA-F]*\).*/\1/p' | head -1)
if [ -z "$CLASS_HASH" ]; then
  CLASS_HASH=$(printf '%s\n' "$DECLARE_OUT" | sed -n 's/.*\(0x[0-9a-fA-F]\{60,\}\).*/\1/p' | head -1)
fi
[ -n "$CLASS_HASH" ] || { echo "Could not determine class hash." >&2; exit 1; }
echo "class hash: $CLASS_HASH"

echo "Deploying"
sncast --wait --account "$ACCOUNT" deploy \
  --network mainnet \
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
echo "Record the address and both transaction hashes in strk20.json and README.md."
echo "Then point web/src/lib/config.ts at the new address and the mainnet pool."
