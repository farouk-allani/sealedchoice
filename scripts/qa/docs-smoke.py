"""Check the built documentation and application CTAs without a wallet.

Run the production docs on 3001 and application on 3000, then:
    python scripts/qa/docs-smoke.py
Outputs go to ignored apps/web/test-results/t15-docs/.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

OUT = Path('apps/web/test-results/t15-docs')
ROUTES = ['/', '/quickstart/', '/guides/buyers/', '/guides/bidders/', '/guides/committee/', '/technical/architecture/', '/technical/scoring/', '/technical/verification/', '/technical/contract/', '/evidence/', '/security/', '/developers/', '/faq/']


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--docs', default='http://127.0.0.1:3001')
    parser.add_argument('--app', default='http://127.0.0.1:3000')
    args = parser.parse_args()
    checks: list[dict[str, object]] = []
    errors: list[str] = []
    OUT.mkdir(parents=True, exist_ok=True)

    def check(ok: bool, label: str) -> None:
        checks.append({'ok': ok, 'label': label})
        print(('PASS ' if ok else 'FAIL ') + label, flush=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        internal: set[str] = set()
        for route in ROUTES:
            response = page.goto(args.docs + route, wait_until='networkidle')
            check(response is not None and response.status == 200, f'{route} responds 200')
            check(page.locator('main h1').count() == 1, f'{route} has one main heading')
            check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{route} desktop fits')
            page.locator('img').evaluate_all('(xs) => xs.forEach(x => x.loading = "eager")')
            page.wait_for_function('Array.from(document.images).every(x => x.complete)', timeout=15000)
            check(page.locator('img').evaluate_all('(xs) => xs.every(x => x.complete && x.naturalWidth > 0)'), f'{route} images load')
            links = page.locator('a[href]').evaluate_all('(xs) => xs.map(x => x.href)')
            internal.update(x for x in links if x.startswith(args.docs))
            if route == '/technical/architecture/':
                page.wait_for_selector('.docusaurus-mermaid-container svg', timeout=30000)
                check(page.locator('.docusaurus-mermaid-container svg').count() == 1, 'architecture diagram renders')
            if route in ['/', '/quickstart/', '/technical/architecture/', '/security/']:
                page.screenshot(path=str(OUT / (route.strip('/').replace('/', '-') or 'home')) + '-1440.png', full_page=True)

        for target in sorted(internal):
            path = urlparse(target).path
            if path not in ROUTES and path != '/search/':
                response = context.request.get(target)
                check(response.status == 200, f'linked asset/route {path}')

        page.goto(args.docs, wait_until='networkidle')
        search = page.locator('input[type="search"], input[placeholder*="Search"]').first
        search.fill('escrow')
        page.wait_for_selector('[class*="suggestion"]', timeout=15000)
        check(page.locator('[class*="suggestion"]').count() > 0, 'local search returns escrow results')
        search.press('ArrowDown')
        search.press('Enter')
        page.wait_for_timeout(700)
        check(urlparse(page.url).path != '/', 'keyboard selects a local search result')

        page.goto(args.docs + '/quickstart/', wait_until='networkidle')
        page.keyboard.press('Tab')
        check('skip' in page.evaluate('document.activeElement.textContent').lower(), 'docs keyboard starts at skip link')
        check(page.locator('link[rel="canonical"]').get_attribute('href') == 'https://docs.sealedchoice.com/quickstart/', 'canonical uses docs domain')

        for width in [320, 390, 768]:
            page.set_viewport_size({'width': width, 'height': 900})
            for route in ['/', '/quickstart/', '/technical/scoring/', '/evidence/', '/developers/']:
                page.goto(args.docs + route, wait_until='networkidle')
                check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{route} fits at {width}')
            page.goto(args.docs, wait_until='networkidle')
            page.get_by_role('button', name='Toggle navigation bar').click()
            page.locator('.navbar-sidebar').wait_for(state='visible')
            check(page.get_by_role('link', name='Try it in two minutes').count() > 0, f'home action exists at {width}')
            check(page.locator('.navbar-sidebar').is_visible(), f'docs mobile menu opens at {width}')
            page.screenshot(path=str(OUT / f'docs-menu-{width}.png'), full_page=True)

        for width in [320, 390, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            page.goto(args.app, wait_until='networkidle')
            check(page.locator('a[href="https://docs.sealedchoice.com/quickstart/"]').is_visible(), f'landing docs CTA visible at {width}')
            check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'landing fits at {width}')
            if width < 768:
                page.get_by_role('button', name='Open navigation').click()
                check(page.locator('#mobile-nav').get_by_role('link', name='Documentation').is_visible(), f'landing mobile docs link at {width}')
            page.screenshot(path=str(OUT / f'landing-{width}.png'), full_page=True)
            for route in ['/tenders', '/tenders/1/award']:
                page.goto(args.app + route, wait_until='networkidle')
                check(page.locator('.app-nav').get_by_role('link', name='Docs', exact=True).is_visible(), f'app docs navigation {route} at {width}')
                check(page.locator('.app-footer').get_by_role('link', name='Read the documentation').is_visible(), f'app docs footer {route} at {width}')
                check(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'{route} fits at {width}')
            page.screenshot(path=str(OUT / f'app-{width}.png'), full_page=True)

        context.close()
        context = browser.new_context(viewport={'width': 390, 'height': 844}, java_script_enabled=False)
        page = context.new_page()
        page.goto(args.docs + '/quickstart/', wait_until='networkidle')
        check('86.66' in page.locator('main').inner_text(), 'docs walkthrough available without JavaScript')
        check(page.get_by_role('link', name='tender 1', exact=True).is_visible(), 'live demo link available without JavaScript')
        browser.close()

    check(not errors, f'no browser runtime errors ({len(errors)})')
    report = {'docs': args.docs, 'app': args.app, 'passed': sum(bool(x['ok']) for x in checks), 'total': len(checks), 'checks': checks, 'errors': errors}
    (OUT / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(f"{report['passed']}/{report['total']} checks passed")
    return 0 if all(x['ok'] for x in checks) else 1


if __name__ == '__main__':
    raise SystemExit(main())
