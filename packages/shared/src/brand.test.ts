import { describe, expect, it } from "vitest";
import { BRAND } from "./index.ts";

describe("BRAND", () => {
  it("holds the product name, domain and tagline", () => {
    expect(BRAND).toEqual({
      name: "SealedChoice",
      domain: "sealedchoice.com",
      tagline: "Sealed tenders, verifiable awards.",
    });
  });
});
