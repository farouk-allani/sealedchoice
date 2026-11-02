// The only place the product name lives in code. Everything else imports BRAND.
export const BRAND = {
  name: "SealedChoice",
  domain: "sealedchoice.com",
  tagline: "Sealed tenders, verifiable awards.",
} as const;

export type Brand = typeof BRAND;
