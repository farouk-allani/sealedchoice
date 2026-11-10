"""Browser smoke test for the T09 pages.

    pnpm --filter web dev        # in another terminal
    python scripts/qa/web-smoke.py [--base http://localhost:3000]

Checks that every page renders from live chain state with **no wallet connected**, that the
recorded final tender 1 values actually reach the screen, that no page logs an error, and that nothing
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

# Values recorded for final tender 1 (PROGRESS, T14, 2026-11-10). The page has to show these, not
# something close to them.
DEMO_TENDER = {
    "title": "Security review of a DAO treasury module (near-sdk, Rust)",
    "rubric_hash_head": "5667a800",
    "winner": "vendor-a.sealedchoice.testnet",
    "winning_score": "86.66",
    "second_score": "47.55",
    "flagged_score": "52.00",
    "root_head": "2bc59965",
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
        check("Paid" in body, "the directory shows the recorded paid tender")
        check(
            page.locator("text=Connect wallet").count() == 1,
            "the list renders with no wallet connected",
        )
        # Not a fixed number: every demo run adds a tender, and a count baked in here would start
        # failing the next time one is created rather than when something actually broke.
        all_tenders = page.locator(".tender-card").count()
        check(all_tenders >= 3, f"the directory lists every tender on the contract ({all_tenders})")
        check(no_overflow(page), "the list does not overflow sideways at 1440")
        page.screenshot(path=str(OUT / "tenders-desktop.png"), full_page=True)

        page.get_by_role("button", name="Open for bids").click()
        check("No tenders are open for bids right now" in page.inner_text("body"), "an empty status filter explains what to do next")
        page.get_by_role("button", name="Show all tenders").click()
        page.get_by_label("Search tenders", exact=True).fill("Tender 1")
        check(page.locator(".tender-card").count() == 1 and "Tender 1" in page.locator(".tender-card").inner_text(), "search narrows real tender data")
        page.get_by_label("Search tenders", exact=True).fill("no-matching-tender")
        check("No matching tenders" in page.inner_text("body"), "an empty search provides a reset action")
        page.get_by_role("button", name="Show all tenders").click()
        check(page.locator(".tender-card").count() == all_tenders, "reset restores the directory")

        print("/tenders/1")
        response = page.goto(f"{base}/tenders/1", wait_until="networkidle")
        check(response is not None and response.status == 200, "the tender page answers 200")
        body = page.inner_text("body")
        check(DEMO_TENDER["title"] in body, "the title comes from the stored rubric")
        check(DEMO_TENDER["winner"] in body, "the winning bidder is named")
        check(
            DEMO_TENDER["winning_score"] in body
            and DEMO_TENDER["second_score"] in body
            and DEMO_TENDER["flagged_score"] in body,
            "all three recorded totals are shown",
        )
        check("Awarded" in body and "Flagged" in body, "the awarded and flagged outcomes show")
        check(DEMO_TENDER["rubric_hash_head"] in body, "the rubric hash is shown")
        check(DEMO_TENDER["root_head"] in body, "the frozen bid set root is shown")
        check("Why flagged?" in body, "a flag can be expanded into plain words")
        check(
            "vendor-b.sealedchoice.testnet" in body and "vendor-c.sealedchoice.testnet" in body,
            "every bidder appears in the bid table",
        )
        check("Accepted" in body, "the evaluation attempt and its outcome are shown")
        check(no_overflow(page), "the tender page does not overflow sideways at 1440")
        page.screenshot(path=str(OUT / "tender-1-desktop.png"), full_page=True)

        print("/tenders/1/bid")
        page.goto(f"{base}/tenders/1/bid", wait_until="networkidle")
        body = page.inner_text("body")
        check(
            "not taking bids" in body.lower(),
            "a closed tender refuses a bid before any wallet prompt",
        )
        page.screenshot(path=str(OUT / "tender-1-bid-closed.png"), full_page=True)

        print("/tenders/new")
        response = page.goto(f"{base}/tenders/new", wait_until="networkidle")
        check(response is not None and response.status == 200, "the create page answers 200")
        page.locator(".create-summary summary").click()
        body = page.inner_text("body")
        check(
            DEMO_TENDER["rubric_hash_head"] in body,
            "the previewed rubric hashes to the one final tender 1 stored",
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
        check(page.get_by_label("Title", exact=False).input_value() == DEMO_TENDER["title"], "moving back preserves the brief")
        check(page.get_by_role("button", name="Create tender", exact=True, include_hidden=True).is_disabled(), "publishing is disabled without a connected wallet and committee")

        # --------------------------------------------------- T11: the three reader pages
        # All three must be useful with no wallet: a reader who has not connected should be told
        # exactly what connecting would get them, not shown a dead control or an error.
        print("/tenders/1/verify")
        response = page.goto(f"{base}/tenders/1/verify", wait_until="networkidle")
        check(response is not None and response.status == 200, "the verify page answers 200")
        page.wait_for_selector(".verify-item .verify-verdict", timeout=60_000)
        page.wait_for_function(
            "() => !document.querySelector('.verify-status')?.innerText.includes('...')",
            timeout=120_000,
        )
        body = page.inner_text("body")
        check("10 of 10 checks passed" in body, "the ten public checks all pass in the browser")
        check(
            page.locator(".verify-item.is-fail").count() == 0,
            "no check reports a failure on a sound tender",
        )
        check(no_overflow(page), "the verify page does not overflow sideways at 1440")
        page.screenshot(path=str(OUT / "t11-verify-desktop.png"), full_page=True)

        print("/tenders/1/debrief")
        response = page.goto(f"{base}/tenders/1/debrief", wait_until="networkidle")
        check(response is not None and response.status == 200, "the debrief page answers 200")
        body = page.inner_text("body")
        check(DEMO_TENDER["title"] in body, "the debrief page names the tender it belongs to")
        check(
            "only your wallet can derive" in body or "Connect the wallet" in body,
            "the debrief page says whose key opens it",
        )
        check(no_overflow(page), "the debrief page does not overflow sideways at 1440")
        page.screenshot(path=str(OUT / "t11-debrief-desktop.png"), full_page=True)

        print("/tenders/1/committee")
        response = page.goto(f"{base}/tenders/1/committee", wait_until="networkidle")
        check(response is not None and response.status == 200, "the committee page answers 200")
        body = page.inner_text("body")
        check("Committee" in body, "the committee page renders")
        check(
            "Who wins is yours to decide" in body or "Connect the wallet of a committee member" in body,
            "the committee page says what is code and what is theirs",
        )
        check(no_overflow(page), "the committee page does not overflow sideways at 1440")
        page.screenshot(path=str(OUT / "t11-committee-desktop.png"), full_page=True)

        print("/tenders/1/award")
        response = page.goto(f"{base}/tenders/1/award", wait_until="networkidle")
        check(response is not None and response.status == 200, "the award page answers 200")
        body = page.inner_text("body")
        check(DEMO_TENDER["winner"] in body, "the award page names the winner from the chain")
        check("Paid" in body, "the payout state comes from the chain")
        check("Payment complete" in body and "12,000.00" in body, "paid award leads with the recorded payment and amount")
        check("Accept by" not in body and "until" not in page.locator(".award-layout").inner_text(), "paid award does not show an outstanding acceptance deadline")
        check(
            "Only " + DEMO_TENDER["winner"] not in body,
            "a settled award does not still offer acceptance",
        )
        check(no_overflow(page), "the award page does not overflow sideways at 1440")
        page.screenshot(path=str(OUT / "t11-award-desktop.png"), full_page=True)
        check_contrast(page, "award page")

        page.goto(f"{base}/tenders/2/award", wait_until="networkidle")
        body = page.inner_text("body")
        check("9,000.00" in body and "vendor-b.sealedchoice.testnet" in body, "demo 2 keeps its actual winner and award amount")
        check("Deviation from ranking" in body and "lower-priced 14-day proposal" in body, "paid deviation keeps the public rationale visible")
        check("Accept by" not in body, "paid deviation has no pending acceptance instruction")

        print("the tender page links to all four")
        page.goto(f"{base}/tenders/1", wait_until="networkidle")
        timeline = page.locator('.tender-lifecycle[data-layout="vertical"]')
        check(timeline.locator('li[data-state="complete"]').count() == 7, "paid tender shows all seven progress steps complete")
        check(timeline.locator('details[open]').count() == 1, "paid progress shows the final step detail by default")
        timeline.get_by_text("Closed and evaluated", exact=True).click()
        check("accepted attempt 2" in timeline.inner_text(), "expanding evaluation shows the real accepted attempt")
        timeline.get_by_text("Closed and evaluated", exact=True).click()
        for name in ["Check this tender", "Your debrief", "Committee", "Award"]:
            check(
                page.get_by_role("link", name=name, exact=True).count() >= 1,
                f"the tender page links to {name}",
            )

        print("contrast, size and weight")
        print("/attacks, recorded evidence without a wallet")
        response = page.goto(f"{base}/attacks", wait_until="networkidle")
        check(response is not None and response.status == 200, "attack evidence answers 200")
        check(page.locator(".attack-records > li").count() == 10, "all ten measured attempts render")
        body = page.inner_text("body")
        attack_report = json.loads((Path(__file__).resolve().parents[2] / "apps/web/src/data/attacks.json").read_text(encoding="utf-8"))
        for summary in page.locator('.attack-records summary').all():
            summary.click()
        body = page.inner_text("body")
        request_ids = [str(record["request_id"]) for record in attack_report["records"] if "request_id" in record]
        for expected in ["E_DUPLICATE_CIPHERTEXT", "E_NOT_WINNER", "E_RATIONALE_REQUIRED", "INJECTION_SUSPECTED", *request_ids]:
            check(expected in body, f"attack evidence includes {expected}")
        check(page.locator('.attack-records a[href*="/txns/"]').count() == 10, "each measured attempt links to its transaction")
        for summary in page.locator('.attack-records summary').all():
            summary.click()
        page.get_by_role("button", name="Flagged for review").click()
        check(page.locator('.attack-records > li').count() == 1 and "Inject instructions" in page.locator('.attack-records').inner_text(), "flag filter isolates the prompt-injection outcome")
        page.get_by_role("button", name="Refused", exact=False).click()
        check(page.locator('.attack-records > li').count() == 9, "refused filter shows the nine rejected calls")
        page.get_by_role("button", name="All attempts").click()
        check(page.locator('.attack-records > li').count() == 10, "all-attempts filter restores the complete record")
        buttons = page.get_by_role("button", name="Run again:")
        check(buttons.count() == 8 and all(button.is_disabled() for button in buttons.all()), "eight contract replays require a connected wallet")
        page.get_by_label("Testnet tender number").fill(str(attack_report["tender_id"]))
        page.keyboard.press("Tab")
        check(page.evaluate("document.activeElement.matches(':focus-visible')"), "attack page keyboard navigation exposes a visible focus target")
        check_contrast(page, "attack page")
        check(no_overflow(page), "attack evidence does not overflow on desktop")
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=str(OUT / "attacks-desktop.png"), full_page=True)
        page.goto(f"{base}/tenders/1", wait_until="networkidle")
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
        for path, name in [
            ("/tenders", "tenders"),
            ("/tenders/1", "tender-1"),
            ("/tenders/new", "tenders-new"),
            ("/tenders/1/debrief", "t11-debrief"),
            ("/tenders/1/committee", "t11-committee"),
            ("/tenders/1/award", "t11-award"),
            ("/attacks", "attacks"),
        ]:
            page.goto(f"{base}{path}", wait_until="networkidle")
            check(no_overflow(page), f"{path} does not overflow sideways at 390")
            if path == "/tenders/1":
                check(page.locator('.tender-lifecycle[data-layout="vertical"]').evaluate("el => getComputedStyle(el).gridTemplateColumns.split(' ').length === 1"), "phone progress keeps one vertical column")
            page.screenshot(path=str(OUT / f"{name}-mobile.png"), full_page=True)

        check(not errors, f"no page errors ({len(errors)} seen)")
        if errors:
            for line in errors[:10]:
                print(f"      {line}")

        context.close()
        context = browser.new_context(viewport=PHONE, java_script_enabled=False)
        page = context.new_page()
        page.goto(f"{base}/attacks", wait_until="networkidle")
        check(page.locator(".attack-records > li").count() == 10, "recorded attack evidence works with JavaScript disabled")
        check(no_overflow(page), "attack evidence has no overflow without JavaScript")
        page.locator('.attack-records summary').first.click()
        check("Access denied" in page.locator('.attack-records').inner_text(), "technical evidence expands without JavaScript")
        page.goto(f"{base}/tenders/1/award", wait_until="networkidle")
        check("Payment complete" in page.inner_text("body"), "paid award renders without JavaScript")
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
