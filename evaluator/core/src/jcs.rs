//! Canonical JSON (RFC 8785) for the subset we hash (reference.py `jcs`): objects with
//! ASCII keys, arrays, strings, integers within ±(2^53 − 1), booleans, null.

use crate::{EvalError, MAX_SAFE_INT};
use serde_json::Value;

/// JCS bytes of `v`.
pub fn jcs(v: &Value) -> Result<Vec<u8>, EvalError> {
    let mut out = String::new();
    write(v, &mut out)?;
    Ok(out.into_bytes())
}

fn write(v: &Value, out: &mut String) -> Result<(), EvalError> {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                if u > MAX_SAFE_INT {
                    return Err(EvalError::JcsUnsafeInteger);
                }
                out.push_str(&u.to_string());
            } else if let Some(i) = n.as_i64() {
                if i.unsigned_abs() > MAX_SAFE_INT {
                    return Err(EvalError::JcsUnsafeInteger);
                }
                out.push_str(&i.to_string());
            } else {
                return Err(EvalError::JcsFloat);
            }
        }
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            if keys.iter().any(|k| !k.is_ascii()) {
                return Err(EvalError::JcsNonAsciiKey);
            }
            // ASCII keys: byte order = UTF-16 code-unit order required by RFC 8785.
            keys.sort();
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(k, out);
                out.push(':');
                if let Some(val) = map.get(k) {
                    write(val, out)?;
                }
            }
            out.push('}');
        }
    }
    Ok(())
}

/// Same escaping as Python `json.dumps(ensure_ascii=False)` and ECMAScript `JSON.stringify`:
/// `"` and `\`, the short escapes \b \t \n \f \r, other controls as \u00xx (lowercase hex),
/// everything else verbatim.
fn write_string(s: &str, out: &mut String) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => {
                let b = c as u32 as usize;
                out.push_str("\\u00");
                out.push(char::from(HEX[b >> 4]));
                out.push(char::from(HEX[b & 0xf]));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn s(v: &Value) -> String {
        String::from_utf8(jcs(v).unwrap()).unwrap()
    }

    #[test]
    fn sorts_keys_without_whitespace() {
        assert_eq!(
            s(&json!({"b": 1, "a": [true, null, "x"], "c": {"z": 0, "y": -2}})),
            r#"{"a":[true,null,"x"],"b":1,"c":{"y":-2,"z":0}}"#
        );
    }

    #[test]
    fn escapes_like_python_json_dumps() {
        // python3 -c 'import json; print(json.dumps("é \n\t\x01\x7f\x1f\"\\\b\f\r", ensure_ascii=False))'
        assert_eq!(
            s(&json!("é\u{2028}\n\t\u{1}\u{7f}\u{1f}\"\\\u{8}\u{c}\r")),
            "\"é\u{2028}\\n\\t\\u0001\u{7f}\\u001f\\\"\\\\\\b\\f\\r\""
        );
    }

    #[test]
    fn rejects_floats_unsafe_integers_and_non_ascii_keys() {
        assert_eq!(jcs(&json!({"p": 1.5})), Err(EvalError::JcsFloat));
        assert_eq!(jcs(&json!(1.0)), Err(EvalError::JcsFloat));
        assert_eq!(
            jcs(&json!(MAX_SAFE_INT + 1)),
            Err(EvalError::JcsUnsafeInteger)
        );
        assert_eq!(
            jcs(&json!(-(MAX_SAFE_INT as i64) - 1)),
            Err(EvalError::JcsUnsafeInteger)
        );
        assert_eq!(s(&json!(MAX_SAFE_INT)), "9007199254740991");
        assert_eq!(s(&json!(-(MAX_SAFE_INT as i64))), "-9007199254740991");
        assert_eq!(jcs(&json!({"clé": 1})), Err(EvalError::JcsNonAsciiKey));
    }
}
