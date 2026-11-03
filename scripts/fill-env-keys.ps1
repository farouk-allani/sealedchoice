<#
.SYNOPSIS
  Fill the *_PRIVATE_KEY values in .env by exporting them from the near-cli-rs keychain.

.DESCRIPTION
  `near account create-account ... save-to-keychain` stores private keys in the OS keychain
  (Windows Credential Manager), not in a file, so scripts that load .env cannot sign anything.
  This script pairs every FOO_ACCOUNT_ID in .env with its FOO_PRIVATE_KEY, exports each key with
  `near account export-account`, and writes it into .env in place.

  A key is never printed, never logged and never passed on a command line: the export output is
  captured, the key is matched out of it, and only the account id and a result are shown. Lines
  that already hold a key are left alone unless -Force is given.

.EXAMPLE
  pwsh scripts/fill-env-keys.ps1
  pwsh scripts/fill-env-keys.ps1 -Only DEPLOYER,ATTACKER
  pwsh scripts/fill-env-keys.ps1 -DryRun
#>
[CmdletBinding()]
param(
    # Network passed to near-cli-rs. Defaults to NETWORK in .env, else testnet.
    [string] $Network,

    # Only fill these prefixes (e.g. DEPLOYER, ATTACKER). Default: all pairs found.
    [string[]] $Only,

    # Overwrite private keys that are already set.
    [switch] $Force,

    # Show what would be filled, export nothing, write nothing.
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repo '.env'
$examplePath = Join-Path $repo '.env.example'

# A NEAR private key is base58 of 64 bytes (87-88 chars). A public key is base58 of 32 bytes
# (43-44 chars), so the length bound is what keeps a public key from being written as a secret.
$keyPattern = '(?:ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{80,100}'

if (-not (Test-Path -LiteralPath $envPath)) {
    if (-not (Test-Path -LiteralPath $examplePath)) {
        throw "Neither .env nor .env.example found in $repo"
    }
    Write-Host ".env not found: copying .env.example" -ForegroundColor Yellow
    if (-not $DryRun) { Copy-Item -LiteralPath $examplePath -Destination $envPath }
    if ($DryRun) { Write-Host "  (-DryRun: not copied; reading .env.example instead)" }
}

$readPath = if (Test-Path -LiteralPath $envPath) { $envPath } else { $examplePath }
$lines = [System.IO.File]::ReadAllLines($readPath)

# Collect FOO_ACCOUNT_ID values and the line index of each FOO_PRIVATE_KEY.
$accounts = @{}
$keyLine = @{}
for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*([A-Z0-9_]+)_ACCOUNT_ID\s*=\s*(.*?)\s*$') {
        $accounts[$Matches[1]] = $Matches[2]
    }
    elseif ($line -match '^\s*([A-Z0-9_]+)_PRIVATE_KEY\s*=') {
        $keyLine[$Matches[1]] = $i
    }
}

if (-not $Network) {
    $networkLine = $lines | Where-Object { $_ -match '^\s*NETWORK\s*=\s*(\S+)' } | Select-Object -First 1
    $Network = if ($networkLine -and $networkLine -match '^\s*NETWORK\s*=\s*(\S+)') { $Matches[1] } else { 'testnet' }
}

# Pairs are prefixes that have both an account id and a private key line.
$prefixes = $keyLine.Keys | Where-Object { $accounts.ContainsKey($_) } | Sort-Object
if ($Only) {
    $wanted = $Only | ForEach-Object { $_.ToUpperInvariant() -replace '_PRIVATE_KEY$|_ACCOUNT_ID$', '' }
    $unknown = $wanted | Where-Object { $prefixes -notcontains $_ }
    if ($unknown) { throw "No ACCOUNT_ID/PRIVATE_KEY pair in .env for: $($unknown -join ', ')" }
    $prefixes = $prefixes | Where-Object { $wanted -contains $_ }
}
if (-not $prefixes) { throw "No FOO_ACCOUNT_ID / FOO_PRIVATE_KEY pairs found in $readPath" }

if ($Network -ne 'testnet') {
    Write-Host "Network is '$Network', not testnet." -ForegroundColor Yellow
    $answer = Read-Host "Export $Network keys into .env? Type the network name to continue"
    if ($answer -ne $Network) { throw 'Aborted.' }
}

Write-Host "Network: $Network"
Write-Host "File:    $envPath`n"

$filled = 0; $skipped = 0; $failed = @()

foreach ($prefix in $prefixes) {
    $accountId = $accounts[$prefix]
    $idx = $keyLine[$prefix]
    $label = "$prefix".PadRight(12)

    if (-not $accountId) {
        Write-Host "$label skip     ${prefix}_ACCOUNT_ID is empty" -ForegroundColor DarkGray
        $skipped++; continue
    }

    $current = ($lines[$idx] -replace '^\s*[A-Z0-9_]+\s*=\s*', '').Trim()
    if ($current -and -not $Force) {
        Write-Host "$label have     $accountId (use -Force to replace)" -ForegroundColor DarkGray
        $skipped++; continue
    }

    if ($DryRun) {
        Write-Host "$label would    $accountId" -ForegroundColor Cyan
        continue
    }

    # Capture everything in memory; nothing from this output is echoed unmasked, and none of it
    # is ever written to a file other than .env. near-cli-rs writes its spinner and its footer to
    # stderr, so the error preference is relaxed here: under 'Stop' those lines raise a
    # NativeCommandError and look like a failed export when the export in fact succeeded.
    $out = ''
    $code = 0
    $prevEAP = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $out = (& near account export-account $accountId using-private-key network-config $Network 2>&1 | Out-String)
        $code = $LASTEXITCODE
    }
    catch {
        $out = $_.Exception.Message
        $code = -1
    }
    finally {
        $ErrorActionPreference = $prevEAP
    }

    $match = [regex]::Match($out, $keyPattern)
    if (-not $match.Success) {
        Write-Host "$label FAILED   $accountId (exit $code, no private key in the output)" -ForegroundColor Red
        # Show what near said, with anything key-shaped masked.
        $masked = [regex]::Replace($out, $keyPattern, '<key>')
        $masked -split "`r?`n" |
            Where-Object { $_.Trim() -and $_ -notmatch 'console command|near\.exe' } |
            Select-Object -Last 4 |
            ForEach-Object { Write-Host "             $($_.Trim())" -ForegroundColor DarkGray }
        $out = ''
        $failed += $accountId; continue
    }

    $lines[$idx] = "${prefix}_PRIVATE_KEY=$($match.Value)"
    $match = $null; $out = ''
    Write-Host "$label filled   $accountId" -ForegroundColor Green
    $filled++
}

if (-not $DryRun -and $filled -gt 0) {
    # LF endings and no BOM: dotenv and the repo's .gitattributes both expect it.
    [System.IO.File]::WriteAllText($envPath, ($lines -join "`n") + "`n", (New-Object System.Text.UTF8Encoding $false))
}

Write-Host ""
Write-Host "filled $filled, skipped $skipped, failed $($failed.Count)"
[System.Array]::Clear($lines, 0, $lines.Count)
[System.GC]::Collect()

if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "For each failure, run it by hand and paste the key into .env yourself:" -ForegroundColor Yellow
    foreach ($a in $failed) { Write-Host "  near account export-account $a using-private-key network-config $Network" }
    exit 1
}
