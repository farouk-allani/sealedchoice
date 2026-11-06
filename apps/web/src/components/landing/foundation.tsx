import Image from "next/image";

const PLATFORMS = [
  {
    name: "NEAR",
    href: "https://near.org/",
    logo: "/brands/near.svg",
    role: "On-chain records",
    className: "foundation-near",
  },
  {
    name: "OutLayer",
    href: "https://app.outlayer.ai/",
    logo: "/brands/outlayer.png",
    role: "Trusted execution",
    className: "foundation-outlayer",
  },
  {
    name: "NEAR AI",
    href: "https://near.ai/",
    logo: "/brands/near-ai.svg",
    role: "Signed model calls",
    className: "foundation-near-ai",
  },
] as const;

export function Foundation() {
  return (
    <aside
      id="foundation"
      className="protocol-foundation"
      aria-labelledby="foundation-heading"
    >
      <div className="foundation-header">
        <h3 id="foundation-heading">Built on</h3>
        <p>
          <span>Encrypted in the browser.</span>{" "}
          <span>Recorded on the chain.</span>
        </p>
      </div>
      <ul className="foundation-platforms" role="list">
        {PLATFORMS.map((platform) => (
          <li key={platform.name}>
            <a
              className={`foundation-platform ${platform.className}`}
              href={platform.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="foundation-brand">
                <Image
                  className="foundation-logo"
                  src={platform.logo}
                  alt={platform.name === "NEAR AI" ? platform.name : ""}
                  width={platform.name === "NEAR AI" ? 730 : 32}
                  height={platform.name === "NEAR AI" ? 138 : 32}
                  unoptimized
                />
                {platform.name !== "NEAR AI" && <span>{platform.name}</span>}
              </span>
              <span className="foundation-role">{platform.role}</span>
              <svg
                className="foundation-arrow"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M5 19 19 5M5 5h14v14" />
              </svg>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
