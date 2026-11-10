# Documentation workspace

Curated public documentation for SealedChoice, built with Docusaurus. Content
is in `docs/`, with an explicit sidebar in `sidebars.ts`. The root repository's
internal planning documents are not a content source.

From the repository root:

```bash
pnpm --filter docs dev
pnpm --filter docs build
pnpm --filter docs serve
```

Development and serve default to port 3001. To use another port:

```bash
pnpm --filter docs exec docusaurus serve --port 3003 --host 127.0.0.1
```

Build output is ignored under `build/`; generated metadata is ignored under
`.docusaurus/`. Broken internal links fail the build. Local search indexes the
built pages and uses no external search credentials. Search requires JavaScript;
the documentation and links are prerendered and work without it.

`vercel.json` describes a source build with project root `apps/docs`. A static
release may instead upload only the validated `build/` output with a separate
static hosting configuration. Never upload the private repository root.

Screenshots in `static/img/` were captured from signed-out public pages at
https://sealedchoice.com on 2026-11-10, viewport 1280 by 900. They depict
recorded testnet state and do not contain private reports. Refresh them when
the demonstrated app changes; keep the captions and evidence dates accurate.

The brand mark follows the app's existing `BrandMark` paths. Public Sans is
copied from the app's licensed Latin variable font, with its SIL OFL retained
at `static/fonts/OFL.txt`. Original source and SHA-256 are recorded in
`apps/web/src/app/components/fonts/sources.json`.

Browser verification from the root:

```bash
python scripts/qa/docs-smoke.py --docs http://127.0.0.1:3003 --app http://127.0.0.1:3002
```

Run this with the docs and app serving those ports. It covers all documented
routes, image loading, local search, keyboard entry, mobile navigation,
application CTAs, page widths, runtime errors and no-JavaScript reading.
