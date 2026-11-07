"""Browser smoke test for the T09 pages.

    pnpm --filter web dev        # in another terminal
    python scripts/qa/web-smoke.py [--base http://localhost:3000]

Checks that every page renders from live chain state with **no wallet connected**, that the
recorded tender 3 values actually reach the screen, that no page logs an error, and that nothing
overflows sideways at phone width. Screenshots and a JSON report go to apps/web/test-results/,
which is git-ignored.

This is a smoke test, not a unit test: it talks to testnet through the app, so it fails if the
RPC is down. The unit tests in apps/web/src cover the same logic offline.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path("apps/web/test-results")
WIDE = {"width": 1440, "height": 900}
PHONE = {"width": 390, "height": 844}

# Values recorded on testnet for tender 3 (PROGRESS, T07/T08). The page has to show these, not
# something close to them.
TENDER_3 = {
    "title": "Security review of a DAO treasury module (near-sdk, Rust)",
    "rubric_hash_head": "5667a800",
    "winner": "vendor-a.sealedchoice.testnet",
    "winning_score": "86.66",
    "second_score": "47.55",
    "flagged_score": "45.00",
    "root_head": "0ff749f8",
}

checks: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> None:
    checks.append((bool(ok), label))
    print(f"  {'pass' if ok else 'FAIL'}  {label}")


def no_overflow(page) -> bool:
    return page.evaluate(
        "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3000")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport=WIDE)
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on(
            "console",
            lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None,
        )

        print("/tenders")
        response = page.goto(f"{base}/tenders", wait_until="networkidle")
        check(response is not None and response.status == 200, "the tender list answers 200")
        body = page.inner_text("body")
        check("Tender 3" in body and "Tender 1" in body, "every tender on the contract is listed")
        check("Paid" in body and "Evaluated" in body, "statuses come from the chain, not a guess")
        check(
            page.locator("text=Connect wallet").count() == 1,
            "the list renders with no wallet connected",
        )
        check(no_overflow(page), "the list does not overflow sideways at 1440")
        page.screenshot(path=str(OUT / "tenders-desktop.png"), full_page=True)

        print("/tenders/3")
        response = page.goto(f"{base}/tenders/3", wait_until="networkidle")
        check(response is not None and response.status == 200, "the tender page answers 200")
        body = page.inner_text("body")
        check(TENDER_3["title"] in body, "the title comes from the stored rubric")
        check(TENDER_3["winner"] in body, "the winning bidder is named")
        check(
            TENDER_3["winning_score"] in body
            and TENDER_3["second_score"] in body
            and TENDER_3["flagged_score"] in body,
            "all three recorded totals are shown",
        )
        check("Awarded" in body and "Flagged" in body, "the awarded and flagged outcomes show")
        check(TENDER_3["rubric_hash_head"] in body, "the rubric hash is shown")
        check(TENDER_3["root_head"] in body, "the frozen bid set root is shown")
        check("Why flagged?" in body, "a flag can be expanded into plain words")
        check(
            "vendor-b.sealedchoice.testnet" in body and "vendor-c.sealedchoice.testnet" in body,
            "every bidder appears in the bid table",
        )
        check("Accepted" in body, "the evaluation attempt and its outcome are shown")
        check(no_overflow(page), "the tender page does not overflow sideways at 1440")
        page.screenshot(path=str(OUT / "tender-3-desktop.png"), full_page=True)

        print("/tenders/3/bid")
        page.goto(f"{base}/tenders/3/bid", wait_until="networkidle")
        body = page.inner_text("body")
        check(
            "not taking bids" in body.lower(),
            "a closed tender refuses a bid before any wallet prompt",
        )
        page.screenshot(path=str(OUT / "tender-3-bid-closed.png"), full_page=True)

        print("/tenders/new")
        response = page.goto(f"{base}/tenders/new", wait_until="networkidle")
        check(response is not None and response.status == 200, "the create page answers 200")
        body = page.inner_text("body")
        check("Weights total 100.00%" in body, "the live weight sum starts valid")
        check(
            TENDER_3["rubric_hash_head"] in body,
            "the previewed rubric hashes to the one tender 3 stored",
        )
        check(
            '"budget_cap_minor":"15000000000"' in body,
            "the preview shows canonical JSON, not a pretty-printed copy",
        )
        check(
            page.locator("button:has-text('Create the tender')").is_disabled(),
            "creating is refused until a wallet and a committee member are there",
        )
        check(no_overflow(page), "the create page does not overflow sideways at 1440")
        page.screenshot(path=str(OUT / "tenders-new-desktop.png"), full_page=True)

        print("404")
        response = page.goto(f"{base}/tenders/99999", wait_until="networkidle")
        check(response is not None and response.status == 404, "an unknown tender is a 404")
        # That navigation logs a console 404 by design, so it is not evidence of a broken page.
        errors[:] = [e for e in errors if "404" not in e]

        print("phone, 390px")
        context.close()
        context = browser.new_context(viewport=PHONE)
        page = context.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror(mobile): {e}"))
        for path, name in [("/tenders", "tenders"), ("/tenders/3", "tender-3"), ("/tenders/new", "tenders-new")]:
            page.goto(f"{base}{path}", wait_until="networkidle")
            check(no_overflow(page), f"{path} does not overflow sideways at 390")
            page.screenshot(path=str(OUT / f"{name}-mobile.png"), full_page=True)

        check(not errors, f"no page errors ({len(errors)} seen)")
        if errors:
            for line in errors[:10]:
                print(f"      {line}")

        browser.close()

    passed = sum(1 for ok, _ in checks if ok)
    report = {
        "base": base,
        "passed": passed,
        "total": len(checks),
        "checks": [{"ok": ok, "label": label} for ok, label in checks],
        "errors": errors,
    }
    (OUT / "web-smoke.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n{passed}/{len(checks)} checks passed. Report and screenshots in {OUT}/")
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
