// Network and contract ids come from env (docs/08-frontend.md); never hardcode them in components.
export const NETWORK = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";
