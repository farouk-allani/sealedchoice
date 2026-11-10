import type { Config } from "@docusaurus/types";
import type { Options, ThemeConfig } from "@docusaurus/preset-classic";
import { BRAND } from "../../packages/shared/src/brand";

const config: Config = {
  title: `${BRAND.name} Docs`,
  tagline: BRAND.tagline,
  favicon: "img/mark.svg",
  url: `https://docs.${BRAND.domain}`,
  baseUrl: "/",
  trailingSlash: true,
  onBrokenLinks: "throw",
  i18n: { defaultLocale: "en", locales: ["en"] },
  markdown: { mermaid: true, hooks: { onBrokenMarkdownLinks: "throw" } },
  themes: [
    "@docusaurus/theme-mermaid",
    ["@easyops-cn/docusaurus-search-local", {
      hashed: true,
      docsRouteBasePath: "/",
      indexBlog: false,
      highlightSearchTermsOnTargetPage: true,
      searchResultLimits: 8,
    }],
  ],
  presets: [["classic", {
    docs: { routeBasePath: "/", sidebarPath: "./sidebars.ts", breadcrumbs: true },
    blog: false,
    pages: false,
    theme: { customCss: "./src/css/custom.css" },
    sitemap: { changefreq: "weekly", priority: 0.5 },
  } satisfies Options]],
  themeConfig: {
    image: "img/overview.png",
    colorMode: { defaultMode: "light", disableSwitch: true, respectPrefersColorScheme: false },
    navbar: {
      title: BRAND.name,
      logo: { alt: "", src: "img/mark.svg" },
      items: [
        { label: "Documentation", to: "/", position: "left" },
        { label: "Try the demo", href: `https://${BRAND.domain}/tenders/1`, position: "right" },
        { label: "Open app", href: `https://${BRAND.domain}/tenders`, position: "right", className: "docs-open-app" },
      ],
    },
    footer: {
      style: "dark",
      links: [
        { title: "Get started", items: [{ label: "Two-minute demo", to: "/quickstart" }, { label: "Buyer guide", to: "/guides/buyers" }, { label: "Bidder guide", to: "/guides/bidders" }] },
        { title: "Check the record", items: [{ label: "Public verification", to: "/technical/verification" }, { label: "Demo evidence", to: "/evidence" }, { label: "Security and limits", to: "/security" }] },
        { title: "Build", items: [{ label: "Architecture", to: "/technical/architecture" }, { label: "Local development", to: "/developers" }, { label: "Open application", href: `https://${BRAND.domain}/tenders` }] },
      ],
      copyright: `${BRAND.name}. Recorded testnet demos. No real funds.`,
    },
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    prism: { additionalLanguages: ["rust", "bash", "json"] },
  } satisfies ThemeConfig,
};

export default config;
