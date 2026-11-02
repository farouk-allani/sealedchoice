#!/bin/sh
# Runs the contract's sandbox suite (contracts/tender/tests/sandbox.rs). Where the open-file hard
# limit is below the 65535 neard asks for (Claude Code cloud containers: 20000), neard runs with
# the LD_PRELOAD shim in fdshim.c (DECISIONS D-022). Extra arguments go to the test binary.
#   scripts/sandbox/test.sh                 # whole suite
#   scripts/sandbox/test.sh i5 --nocapture  # one test, with output
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
cargo test -p tender-contract --features sandbox-tests --test sandbox --no-run
if [ "$(ulimit -Hn)" != "unlimited" ] && [ "$(ulimit -Hn)" -lt 65535 ]; then
  neard=$(ls -t target/debug/build/near-sandbox-*/out/.near/near-sandbox-*/near-sandbox 2>/dev/null | head -n 1)
  [ -n "$neard" ] || { echo "neard sandbox binary not found under target/debug/build" >&2; exit 1; }
  out="$root/target/sandbox-shim"
  mkdir -p "$out"
  cc -shared -fPIC -O2 -o "$out/fdshim.so" scripts/sandbox/fdshim.c -ldl
  printf '#!/bin/sh\nLD_PRELOAD=%s exec %s "$@"\n' "$out/fdshim.so" "$root/$neard" > "$out/neard"
  chmod +x "$out/neard"
  export NEAR_SANDBOX_BIN_PATH="$out/neard"
fi
exec cargo test -p tender-contract --features sandbox-tests --test sandbox -- "$@"
