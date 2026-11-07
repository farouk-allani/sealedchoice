import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ContractError, RpcError, viewCall } from "./rpc.ts";

const encoder = new TextEncoder();

/** An RPC answer carrying `value` the way nearcore returns it: the bytes of the JSON. */
function rpcOk(value: unknown): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "x",
      result: { result: Array.from(encoder.encode(JSON.stringify(value))), logs: [] },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function rpcBody(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(response: Response | (() => never)) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (typeof response === "function") response();
    return response as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

interface SentQuery {
  method: string;
  params: {
    request_type: string;
    finality: string;
    account_id: string;
    method_name: string;
    args_base64: string;
  };
}

/** The request body of the nth call, as the object that was sent. */
function sentBody(fetchMock: ReturnType<typeof mockFetch>, nth = 0): SentQuery {
  const init = fetchMock.mock.calls[nth]?.[1];
  return JSON.parse(String(init?.body)) as SentQuery;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const call = (schema: z.ZodType<unknown>, args?: Record<string, unknown>) =>
  viewCall({ contractId: "tenders.test", method: "get_thing", args, schema });

describe("viewCall", () => {
  it("decodes the byte array and validates it", async () => {
    mockFetch(rpcOk({ id: 3, status: "Open" }));
    const value = await call(z.object({ id: z.int(), status: z.string() }));
    expect(value).toEqual({ id: 3, status: "Open" });
  });

  it("sends a call_function query with base64 arguments", async () => {
    const fetchMock = mockFetch(rpcOk(true));
    await call(z.boolean(), { tender_id: 3 });
    const body = sentBody(fetchMock);
    expect(body.method).toBe("query");
    expect(body.params.request_type).toBe("call_function");
    expect(body.params.method_name).toBe("get_thing");
    expect(body.params.account_id).toBe("tenders.test");
    expect(atob(body.params.args_base64)).toBe('{"tender_id":3}');
  });

  it("reads the newest block unless asked for a final one", async () => {
    const fetchMock = mockFetch(rpcOk(true));
    await call(z.boolean());
    expect(sentBody(fetchMock).params.finality).toBe("optimistic");

    vi.unstubAllGlobals();
    const finalFetch = mockFetch(rpcOk(true));
    await viewCall({
      contractId: "tenders.test",
      method: "get_thing",
      schema: z.boolean(),
      finality: "final",
    });
    expect(sentBody(finalFetch).params.finality).toBe("final");
  });

  it("turns a contract panic into a ContractError carrying its code", async () => {
    mockFetch(
      rpcBody({
        jsonrpc: "2.0",
        id: "x",
        result: { error: "wasm execution failed with error: Smart contract panicked: E_NO_TENDER" },
      }),
    );
    const error = await call(z.unknown()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContractError);
    expect((error as ContractError).code).toBe("E_NO_TENDER");
  });

  it("reports a JSON-RPC error as an RpcError", async () => {
    mockFetch(
      rpcBody({ jsonrpc: "2.0", id: "x", error: { message: "handler error", cause: { name: "UNKNOWN_BLOCK" } } }),
    );
    const error = await call(z.unknown()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).message).toContain("UNKNOWN_BLOCK");
  });

  it("reports an HTTP failure", async () => {
    mockFetch(new Response("gateway timeout", { status: 504, statusText: "Gateway Timeout" }));
    await expect(call(z.unknown())).rejects.toBeInstanceOf(RpcError);
  });

  it("reports an unreachable endpoint", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(call(z.unknown())).rejects.toBeInstanceOf(RpcError);
  });

  it("refuses an answer that does not match the schema", async () => {
    mockFetch(rpcOk({ id: "three" }));
    const error = await call(z.object({ id: z.int() })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).message).toContain("unexpected shape");
  });

  it("refuses a result that is not valid UTF-8", async () => {
    mockFetch(
      rpcBody({ jsonrpc: "2.0", id: "x", result: { result: [0xff, 0xfe, 0xfd], logs: [] } }),
    );
    const error = await call(z.unknown()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).message).toContain("UTF-8");
  });
});
