#!/usr/bin/env bash
# Set up a Linux toolchain for this repo inside WSL (or any bare Ubuntu).
#
# Why: the Windows laptop cannot build the Rust side. near-sdk pulls aws-lc-sys through
# near-primitives -> near-crypto, which needs a C toolchain and NASM on Windows, and near-sandbox
# ships no Windows binary at all. A Linux userland solves both and runs the sandbox suite that
# Claude Code cloud containers refuse (their open-file hard limit is 20000; neard wants 65535).
#
# The repo is NOT cloned: WSL builds the same checkout on /mnt/c, so there is one source of truth
# and nothing to keep in sync. Only the build output moves to the Linux filesystem, where it is
# roughly as fast as a native build; leaving target/ on /mnt/c is what makes cargo crawl there.
#
# Versions come from rust-toolchain.toml and docs/references.md (D-015). Run with:
#     wsl -d Ubuntu -- bash /mnt/c/Users/DELL/Desktop/sealedchoice/scripts/setup-wsl.sh
# It asks for your sudo password once, takes 15-25 minutes, and is safe to re-run.

set -euo pipefail

REPO_WIN_PATH="${REPO_WIN_PATH:-/mnt/c/Users/DELL/Desktop/sealedchoice}"
NODE_MAJOR=22
step() { printf '\n== %s ==\n' "$1"; }

step "stop the Windows PATH leaking into WSL"
# Without this, `pnpm` resolves to the Windows shim and dies with "exec: node: not found", and
# /etc/profile fails to parse because "Program Files (x86)" arrives unquoted. Needs `wsl --shutdown`
# from Windows to take effect, which the closing message asks for.
if ! grep -qs 'appendWindowsPath' /etc/wsl.conf 2>/dev/null; then
  sudo tee -a /etc/wsl.conf >/dev/null <<'CONF'

[interop]
appendWindowsPath=false
CONF
  echo "added [interop] appendWindowsPath=false to /etc/wsl.conf"
else
  echo "already set"
fi

step "system packages"
sudo apt-get update -qq
# build-essential + pkg-config + libssl-dev: aws-lc-sys and the near crates.
# libudev-dev: near-cli-rs if binstall falls back to a source build.
sudo apt-get install -y -qq \
  build-essential pkg-config libssl-dev libudev-dev \
  curl git unzip ca-certificates

step "rust"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
fi
export PATH="$HOME/.cargo/bin:$PATH"
# rust-toolchain.toml pins the version; running rustup inside the repo installs exactly that one.
( cd "$REPO_WIN_PATH" && rustup show >/dev/null )
rustup target add wasm32-unknown-unknown   # near contracts
rustup target add wasm32-wasip2            # evaluator/wasm for OutLayer
rustup component add clippy rustfmt

step "cargo tools (prebuilt, no source builds)"
if ! command -v cargo-binstall >/dev/null 2>&1; then
  curl -L --proto '=https' --tlsv1.2 -sSf \
    https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | bash
fi
# --no-confirm only: passing -y as well makes cargo-binstall exit before installing anything.
cargo binstall --no-confirm cargo-near@0.22.0 near-cli-rs@0.30.1 cargo-nextest

step "node $NODE_MAJOR and pnpm"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]; then
  # Ubuntu 22.04's own node is far below the >= 22.12 this repo needs.
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
sudo corepack enable

step "wasmtime (runs the evaluator harness)"
if ! command -v wasmtime >/dev/null 2>&1; then
  curl https://wasmtime.dev/install.sh -sSf | bash
fi

step "build output on the Linux filesystem"
# cargo on /mnt/c is slow because of target/, not the sources. Redirecting it recovers most of
# the speed while keeping one checkout that both Windows and WSL read.
mkdir -p "$HOME/.cargo-target/sealedchoice"
for rc in "$HOME/.bashrc" "$HOME/.profile"; do
  [ -f "$rc" ] || continue
  grep -q 'CARGO_TARGET_DIR' "$rc" && continue
  cat >> "$rc" <<'RC'

# SealedChoice: keep cargo's output off /mnt/c, where it is several times slower.
export CARGO_TARGET_DIR="$HOME/.cargo-target/sealedchoice"
export PATH="$HOME/.cargo/bin:$PATH"
RC
done

step "versions"
rustc --version
cargo near --version
near --version
node --version
pnpm --version
python3 --version
wasmtime --version 2>/dev/null || true
echo "fd hard limit: $(ulimit -Hn)   (neard needs 65535)"

cat <<EOF

Done. Two things before using it:

  1. From Windows PowerShell, run:   wsl --shutdown
     That is what makes appendWindowsPath=false take effect.

  2. Then:   wsl -d Ubuntu
             cd $REPO_WIN_PATH
             cargo test --workspace

The sandbox suite, which cannot run on Windows or in a cloud container:

     cargo test -p tender-contract --features sandbox-tests --test sandbox
EOF
