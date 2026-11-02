import { BRAND } from "@tender/shared";

// Placeholder home page. Real pages arrive at T09 (docs/08-frontend.md).
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-semibold">{BRAND.name}</h1>
      <p className="mt-3 text-neutral-600">{BRAND.tagline}</p>
    </main>
  );
}
