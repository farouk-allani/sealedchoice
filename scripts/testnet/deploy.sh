#!/usr/bin/env bash
# T07 step 1-2: deploy the demo token and the tender contract on testnet.
#
# Run from Git Bash on WINDOWS. near-cli-rs signs from the Windows Credential Manager, which is
# where G0 put the keys for `tenders.` and `usdc.`. Those two accounts own contracts and hold
# escrow, so their full-access keys deliberately stay OUT of `.env`: only the accounts that the
# e2e script has to impersonate (buyer, vendors) have keys in the file.
#
#   ./deploy.sh token      deploy + init the NEP-141 demo token, register the accounts
#   ./deploy.sh contract   deploy + init the tender contract (first time only), then add_evaluator
#   ./deploy.sh upgrade    deploy new code over an initialised contract, keeping its state
#                          REFUSED by default since D-035: `Tender` gained `created_at_ns`,
#                          so the current code cannot read tenders stored by the old build.
#   ./deploy.sh evaluator  add_evaluator only (after a rebuild)
#   ./deploy.sh show       read back what is deployed
#
# Needs EVALUATOR_WASM_URL and EVALUATOR_WASM_SHA256 for the evaluator steps.
set -uo pipefail
export MSYS_NO_PATHCONV=1

NETWORK=${NETWORK:-testnet}
# CLAUDE.md requires an explicit yes for any mainnet transaction, and every call below ends
# in `sign-with-keychain send`, which sends immediately. The TS scripts enforce this in code
# (scripts/lib/env.ts); this one had nothing, so a stray env var was a real deploy.
if [ "$NETWORK" != "testnet" ] && [ "${CONFIRM:-}" != "1" ]; then
  echo "refusing to touch $NETWORK without CONFIRM=1" >&2
  exit 2
fi
PARENT=${PARENT:-sealedchoice.testnet}
CONTRACT=${CONTRACT_ID:-tenders.sealedchoice.testnet}
# Two of these defaults are set on a second line rather than with ${X:-default}: the secret
# scanner matches `TOKEN...=` or `SECRETS...=` followed by 20+ word characters, and an account id
# trips it. Writing it this way keeps the scan strict instead of adding an exception for this file.
FT_ACCOUNT=${TOKEN_ID:-}
[ -n "$FT_ACCOUNT" ] || FT_ACCOUNT=usdc.sealedchoice.testnet
OUTLAYER=${OUTLAYER_CONTRACT_ID:-outlayer.testnet}
BUYER=${BUYER_ACCOUNT_ID:-buyer.sealedchoice.testnet}
REVIEWER=${REVIEWER_ACCOUNT_ID:-reviewer.sealedchoice.testnet}
VENDORS=${VENDORS:-vendor-a.sealedchoice.testnet,vendor-b.sealedchoice.testnet,vendor-c.sealedchoice.testnet}
SECRETS_PROFILE=${OUTLAYER_SECRETS_PROFILE:-sealedchoice}
PROFILE_OWNER=${OUTLAYER_SECRETS_ACCOUNT_ID:-}
[ -n "$PROFILE_OWNER" ] || PROFILE_OWNER=sealedchoice.testnet
WASM_URL=${EVALUATOR_WASM_URL:-}
WASM_SHA256=${EVALUATOR_WASM_SHA256:-}

# docs/03: a deadline must be at least this far out. 300 s on testnet keeps the demo quick while
# leaving room for the bid transactions; the contract refuses anything shorter.
MIN_DEADLINE_DELAY_NS=${MIN_DEADLINE_DELAY_NS:-300000000000}
# 1,000,000 tUSDC at 6 decimals: enough to fund many demo tenders without re-minting.
TOTAL_SUPPLY=${TOTAL_SUPPLY:-1000000000000}

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
cd "$HERE"
mkdir -p evidence
winpath() { cygpath -w "$1"; }

# The Rust build lives on the Linux side of WSL (PROGRESS: /mnt/c is too slow for cargo), so the
# wasm has to be copied out before near-cli-rs on Windows can read it.
wasm_from_wsl() { # <relative path under CARGO_TARGET_DIR> <local name>
  local rel=$1 out="$HERE/evidence/$2"
  wsl -d Ubuntu -- bash -lc "cp \"\$HOME/.cargo-target/sealedchoice/$rel\" /mnt/c${HERE#/c}/evidence/$2" || return 1
  ls -l "$out"
}

# MSYS_NO_PATHCONV=1 is on for near-cli-rs, so it also stops the /c/... -> C:\... translation
# that Windows node needs for its script argument: convert that one path by hand.
VIEW_JS="$(winpath "$REPO/scratch/g1-outlayer/view.mjs")"
view() { node "$VIEW_JS" "$@" || echo "  (not deployed or view failed)"; }

need() { for v in "$@"; do if [ -z "${!v}" ]; then echo "set $v first (see the header of $0)"; exit 2; fi; done; }

case ${1:-} in
token)
  wasm_from_wsl near/mock_ft/mock_ft.wasm mock_ft.wasm || exit 1
  echo "== deploy $FT_ACCOUNT"
  near contract deploy "$FT_ACCOUNT" use-file "$(winpath "$HERE/evidence/mock_ft.wasm")" \
    with-init-call new json-args \
    "{\"owner_id\":\"$BUYER\",\"total_supply\":\"$TOTAL_SUPPLY\",\"symbol\":\"tUSDC\",\"decimals\":6}" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" sign-with-keychain send 2>&1 | tail -5
  # NEP-145: every account that can receive tokens must be registered first, and the tender
  # contract must be registered before any escrow lands on it.
  for a in $CONTRACT $REVIEWER ${VENDORS//,/ }; do
    echo "== storage_deposit $a"
    near contract call-function as-transaction "$FT_ACCOUNT" storage_deposit \
      json-args "{\"account_id\":\"$a\",\"registration_only\":true}" \
      prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' \
      sign-as "$PARENT" network-config "$NETWORK" sign-with-keychain send 2>&1 | tail -2
  done
  ;;

contract)
  wasm_from_wsl near/tender_contract/tender_contract.wasm tender_contract.wasm || exit 1
  echo "== deploy $CONTRACT  owner=$PARENT  outlayer=$OUTLAYER  profile=$SECRETS_PROFILE"
  near contract deploy "$CONTRACT" use-file "$(winpath "$HERE/evidence/tender_contract.wasm")" \
    with-init-call new json-args \
    "{\"owner\":\"$PARENT\",\"outlayer\":\"$OUTLAYER\",\"secrets_ref\":{\"profile\":\"$SECRETS_PROFILE\",\"account_id\":\"$PROFILE_OWNER\"},\"min_deadline_delay_ns\":$MIN_DEADLINE_DELAY_NS}" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" sign-with-keychain send 2>&1 | tail -5
  "$0" evaluator
  ;;

upgrade)
  # Since D-035 this is a loaded gun pointed at the demo. `Tender` gained `created_at_ns`, and borsh
  # reads fields positionally, so this build cannot deserialise a tender written by the deployed
  # one: every `get_tender` would panic and tenders 1-4 would be unreadable for good, taking the
  # landing page, /tenders, the verify page and `pnpm verify` with them. There is no undo short of
  # redeploying the old code. T14 step 2 deploys the final contract to a FRESH account instead.
  if [ "${ALLOW_STATE_BREAKING_UPGRADE:-}" != "1" ]; then
    echo "refusing: Tender gained created_at_ns (D-035), so this build cannot read tenders stored" >&2
    echo "by $CONTRACT. Upgrading it would make tenders 1-4 permanently unreadable." >&2
    echo "Deploy to a fresh account instead (T14 step 2): CONTRACT_ID=v1.tenders.sealedchoice.testnet ./deploy.sh contract" >&2
    echo "If you really mean to break that state, re-run with ALLOW_STATE_BREAKING_UPGRADE=1." >&2
    exit 2
  fi
  # `with-init-call new` on a contract that already holds state fails the whole transaction and
  # leaves the old code live - which is silent unless you compare code hashes afterwards. An
  # upgrade deploys the code alone and keeps `next_tender_id`, the tenders and the evaluators.
  wasm_from_wsl near/tender_contract/tender_contract.wasm tender_contract.wasm || exit 1
  echo "== upgrade $CONTRACT (no init; state kept)"
  near contract deploy "$CONTRACT" use-file "$(winpath "$HERE/evidence/tender_contract.wasm")"     without-init-call network-config "$NETWORK" sign-with-keychain send 2>&1 | tail -4
  echo "-- deployed code hash (compare with the local build):"
  node -e 'const{createHash}=require("node:crypto");const h=createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest();const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let n=BigInt("0x"+h.toString("hex")),o="";while(n>0){o=A[Number(n%58n)]+o;n/=58n;}console.log("   local:",o)' "$(winpath "$HERE/evidence/tender_contract.wasm")"
  node "$VIEW_JS" "$CONTRACT" version '{}' >/dev/null 2>&1
  curl -sS -X POST https://rpc.$NETWORK.near.org -H 'content-type: application/json'     -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$CONTRACT\"}}"     | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("   chain:",JSON.parse(s).result.code_hash))'
  ;;

evaluator)
  need WASM_URL WASM_SHA256
  # add_evaluator is append-only by design (existing tenders keep the copy they made), so adding
  # the same build twice leaves a confusing duplicate that cannot be removed.
  if node "$VIEW_JS" "$CONTRACT" get_evaluators '{}' 2>/dev/null | grep -q "$WASM_SHA256"; then
    echo "== add_evaluator skipped: $WASM_SHA256 is already pinned"
    exit 0
  fi
  echo "== add_evaluator  $WASM_SHA256"
  near contract call-function as-transaction "$CONTRACT" add_evaluator \
    json-args "{\"evaluator\":{\"wasm_url\":\"$WASM_URL\",\"wasm_sha256\":\"$WASM_SHA256\",\"build_target\":\"wasm32-wasip2\",\"source_tag\":\"evaluator-v0.1.0\"}}" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
    sign-as "$PARENT" network-config "$NETWORK" sign-with-keychain send 2>&1 | tail -4
  ;;

show)
  echo "-- token metadata";  view "$FT_ACCOUNT" ft_metadata '{}'
  echo "-- buyer balance";   view "$FT_ACCOUNT" ft_balance_of "{\"account_id\":\"$BUYER\"}"
  echo "-- contract config"; view "$CONTRACT" get_config '{}'
  echo "-- evaluators";      view "$CONTRACT" get_evaluators '{}'
  echo "-- version";         view "$CONTRACT" version '{}'
  ;;

*)
  sed -n '2,16p' "$0"
  exit 2
  ;;
esac
