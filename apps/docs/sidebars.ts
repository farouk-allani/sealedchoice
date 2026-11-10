import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    { type: "category", label: "Start here", collapsed: false, items: ["index", "quickstart"] },
    { type: "category", label: "Use SealedChoice", collapsed: false, items: ["guides/buyers", "guides/bidders", "guides/committee"] },
    { type: "category", label: "Understand the system", collapsed: false, items: ["technical/architecture", "technical/scoring", "technical/verification", "technical/contract"] },
    "evidence", "security", "developers", "faq",
  ],
};

export default sidebars;
