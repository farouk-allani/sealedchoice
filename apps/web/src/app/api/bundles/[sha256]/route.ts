// PUT/GET /api/bundles/<sha256>: content-addressed evidence bundles (docs/06, task T06, D-021).
// The rules live in lib/bundles/handler.ts; this file only wires them to Next.js.
import { bundleStoreFromEnv } from "@/lib/bundles/config";
import { handleGet, handleOptions, handlePut } from "@/lib/bundles/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ sha256: string }>;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { sha256 } = await ctx.params;
  return handleGet(sha256, bundleStoreFromEnv());
}

export function OPTIONS(): Response {
  return handleOptions();
}

export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  const { sha256 } = await ctx.params;
  return handlePut(req, sha256, bundleStoreFromEnv());
}
