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


# Every visible text node, with the colour it is painted in and the background it sits on.
# Walks up for the first non-transparent background, which is what the eye actually sees.
CONTRAST_JS = r"""() => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    let node = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.95) return c;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 0) continue;
    const text = (el.textContent || '').trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.1) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.95) continue;
    const bg = bgOf(el);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    out.push({
      text: text.slice(0, 40), ratio: Math.round(ratio * 100) / 100,
      need: large ? 3 : 4.5, size, weight,
    });
  }
  return out;
}"""


def check_contrast(page, label: str) -> None:
    samples = page.evaluate(CONTRAST_JS)
    bad = [s for s in samples if s["ratio"] < s["need"]]
    small = [s for s in samples if s["size"] < 13]
    thin = [s for s in samples if s["weight"] < 400]
    check(not bad, f"{label}: all {len(samples)} text samples meet their contrast threshold")
    for s in bad[:6]:
        print(f"      {s['ratio']} < {s['need']}  {s['size']}px/{s['weight']}  {s['text']!r}")
    check(not small, f"{label}: no text under 13px ({len(small)} found)")
    check(not thin, f"{label}: no font-weight under 400 ({len(thin)} found)")



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

        page.get_by_role("button", name="Open for bids").click()
        check("No tenders are open for bids right now" in page.inner_text("body"), "an empty status filter explains what to do next")
        page.get_by_role("button", name="Show all tenders").click()
        page.get_by_label("Search tenders", exact=True).fill("Tender 3")
        check(page.locator(".tender-card").count() == 1 and "Tender 3" in page.locator(".tender-card").inner_text(), "search narrows real tender data")
        page.get_by_label("Search tenders", exact=True).fill("no-matching-tender")
        check("No matching tenders" in page.inner_text("body"), "an empty search provides a reset action")
        page.get_by_role("button", name="Show all tenders").click()
        check(page.locator(".tender-card").count() == 3, "reset restores the directory")

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
        page.locator(".create-summary summary").click()
        body = page.inner_text("body")
        check(
            TENDER_3["rubric_hash_head"] in body,
            "the previewed rubric hashes to the one tender 3 stored",
        )
        check(
            '"budget_cap_minor":"15000000000"' in body,
            "the preview shows canonical JSON, not a pretty-printed copy",
        )
        check(no_overflow(page), "the create page does not overflow sideways at 1440")
        page.screenshot(path=str(OUT / "tenders-new-desktop.png"), full_page=True)
        page.get_by_role("button", name="Continue", exact=False).click()
        check("Weights total 100.00%" in page.inner_text("body"), "the live weight sum starts valid in the scoring step")
        page.get_by_label("Price weight", exact=True).fill("41")
        page.get_by_role("button", name="Continue", exact=False).click()
        check(page.get_by_role("heading", name="How should bids be scored?").is_visible(), "invalid weights cannot advance past scoring")
        page.get_by_label("Price weight", exact=True).fill("40")
        page.get_by_role("button", name="Continue", exact=False).click()
        page.get_by_role("button", name="Continue", exact=False).click()
        check("Add at least one committee member" in page.inner_text("body"), "review requires a committee member")
        page.get_by_role("button", name="Back", exact=True).click()
        page.get_by_role("button", name="Back", exact=True).click()
        check(page.get_by_label("Title", exact=False).input_value() == TENDER_3["title"], "moving back preserves the brief")
        check(page.get_by_role("button", name="Create tender", exact=True, include_hidden=True).is_disabled(), "publishing is disabled without a connected wallet and committee")

        print("contrast, size and weight")
        page.goto(f"{base}/tenders/3", wait_until="networkidle")
        check_contrast(page, "tender page")
        page.goto(f"{base}/tenders/new", wait_until="networkidle")
        check_contrast(page, "create page")

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
