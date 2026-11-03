// JSON as reference.py and the Rust port read it (DECISIONS D-017, D-020). `JSON.parse` cannot be
// used for bid plaintext or model outputs: it turns `12.0` into the integer 12 (Python and
// serde_json keep a float, so `delivery_days: 12.0` is ineligible) and rounds integers beyond 2^53.
// This parser keeps each number's kind from its source text: integers as bigint, anything with a
// fraction or exponent as a float. Strict RFC 8259 with serde_json's limits (D-020): no NaN or
// Infinity, no lone surrogates, no number beyond the f64 range, at most MAX_DEPTH nested containers.
// Duplicate keys keep the last value (as Python, JavaScript and serde_json do).

/** An integer literal (`-0` is the integer 0, as in Python and serde_json). */
export class JsonInt {
  constructor(readonly value: bigint) {}
}

/** A literal with a fraction or an exponent: a float in Python and serde_json, whatever its value. */
export class JsonFloat {
  constructor(readonly value: number) {}
}

export type Json = null | boolean | string | JsonInt | JsonFloat | Json[] | JsonObject;

export class JsonObject {
  constructor(readonly entries: ReadonlyMap<string, Json>) {}
  get(key: string): Json | undefined {
    return this.entries.get(key);
  }
}

export class JsonParseError extends Error {
  constructor(message: string, readonly at: number) {
    super(`${message} at ${at}`);
    this.name = "JsonParseError";
  }
}

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);
/** serde_json's recursion limit: the 128th nested container is an error. */
export const MAX_DEPTH = 127;

export function parseJson(text: string): Json {
  let i = 0;
  const fail = (msg: string): never => {
    throw new JsonParseError(msg, i);
  };
  const ws = (): void => {
    while (i < text.length && WS.has(text.charCodeAt(i))) i++;
  };
  const expect = (lit: string): void => {
    if (!text.startsWith(lit, i)) fail(`expected ${lit}`);
    i += lit.length;
  };

  function string(): string {
    expect('"');
    let out = "";
    for (;;) {
      if (i >= text.length) fail("unterminated string");
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i++;
        return out;
      }
      if (c < 0x20) fail("control character in string");
      if (c >= 0xd800 && c <= 0xdfff) {
        // Raw surrogates: only a well-formed pair is text.
        const d = text.charCodeAt(i + 1);
        if (c > 0xdbff || !(d >= 0xdc00 && d <= 0xdfff)) fail("lone surrogate");
        out += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c !== 0x5c) {
        out += text[i];
        i++;
        continue;
      }
      i++;
      const e = text[i];
      i++;
      switch (e) {
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "/":
          out += "/";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const hi = hex4();
          if (hi >= 0xd800 && hi <= 0xdbff) {
            if (text.slice(i, i + 2) !== "\\u") fail("lone surrogate");
            i += 2;
            const lo = hex4();
            if (lo < 0xdc00 || lo > 0xdfff) fail("lone surrogate");
            out += String.fromCharCode(hi, lo);
          } else if (hi >= 0xdc00 && hi <= 0xdfff) {
            fail("lone surrogate");
          } else {
            out += String.fromCharCode(hi);
          }
          break;
        }
        default:
          fail("bad escape");
      }
    }
  }

  function hex4(): number {
    const h = text.slice(i, i + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(h)) fail("bad \\u escape");
    i += 4;
    return parseInt(h, 16);
  }

  function number(): JsonInt | JsonFloat {
    const m = /^-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(i));
    if (m === null) fail("bad number");
    const lit = (m as RegExpExecArray)[0];
    i += lit.length;
    // Python's json.loads would give inf for 1e999 (or a huge int); serde_json refuses any literal
    // beyond the f64 range, integer or not. Refuse, like Rust.
    const v = Number(lit);
    if (!Number.isFinite(v)) fail("number out of range");
    if ((m as RegExpExecArray)[1] === undefined && (m as RegExpExecArray)[2] === undefined) {
      return new JsonInt(BigInt(lit));
    }
    return new JsonFloat(v);
  }

  /** `depth` = number of enclosing containers. */
  function value(depth: number): Json {
    ws();
    const c = text[i];
    if ((c === "{" || c === "[") && depth >= MAX_DEPTH) fail("nesting too deep");
    if (c === "{") {
      i++;
      const entries = new Map<string, Json>();
      ws();
      if (text[i] === "}") {
        i++;
        return new JsonObject(entries);
      }
      for (;;) {
        ws();
        const k = string();
        ws();
        expect(":");
        entries.set(k, value(depth + 1));
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        expect("}");
        return new JsonObject(entries);
      }
    }
    if (c === "[") {
      i++;
      const out: Json[] = [];
      ws();
      if (text[i] === "]") {
        i++;
        return out;
      }
      for (;;) {
        out.push(value(depth + 1));
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        expect("]");
        return out;
      }
    }
    if (c === '"') return string();
    if (c === "t") {
      expect("true");
      return true;
    }
    if (c === "f") {
      expect("false");
      return false;
    }
    if (c === "n") {
      expect("null");
      return null;
    }
    return number();
  }

  const v = value(0);
  ws();
  if (i !== text.length) fail("trailing characters");
  return v;
}
