//! NEP-297 events: `EVENT_JSON:{"standard":"sealedchoice","version":"1.0.0","event":…,"data":[…]}`.

use crate::{EVENT_STANDARD, EVENT_VERSION};
use near_sdk::env;
use near_sdk::serde_json::{Value, json};

pub(crate) fn emit(event: &str, data: Value) {
    let body = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{body}"));
}
