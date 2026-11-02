//! Test double for the OutLayer contract, used only in sandbox tests (docs/03-contract.md
//! "Testing"). It behaves like the real one as read in its source (docs/references.md):
//! `request_execution` yields a promise (`promise_yield_create` → `on_execution_response`) with
//! 50 Tgas + 25 Mgas per `input_data` byte beyond 32 KiB of resume gas, and returns it, so the
//! caller's `.then()` callback receives what `on_execution_response` returns: for `Text`, the
//! guest's stdout as a JSON string; `null` when the run failed. Tests play the TEE by calling
//! `resolve(request_id, output)`.
#![deny(clippy::unwrap_used, clippy::expect_used)]

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::store::IterableMap;
use near_sdk::{AccountId, BorshStorageKey, Gas, GasWeight, PanicOnDefault, env, near, require};

const DATA_ID_REGISTER: u64 = 37;
/// Same constants as the OutLayer contract.
const MIN_RESPONSE_GAS: Gas = Gas::from_tgas(50);
const INPUT_DATA_FREE_BYTES: usize = 32 * 1024;
const CALLBACK_GAS_PER_INPUT_BYTE: u64 = 25_000_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Requests,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Request {
    pub request_id: u64,
    pub caller: AccountId,
    /// JSON text of every argument as received.
    pub source: String,
    pub resource_limits: String,
    pub input_data: Option<String>,
    pub secrets_ref: String,
    pub response_format: String,
    pub payer_account_id: AccountId,
    pub deposit: U128,
    pub data_id: Vec<u8>,
    pub resolved: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockOutlayer {
    requests: IterableMap<u64, Request>,
    next_id: u64,
}

fn response_gas(input_len: usize) -> Gas {
    let over = input_len.saturating_sub(INPUT_DATA_FREE_BYTES) as u64;
    Gas::from_gas(
        MIN_RESPONSE_GAS
            .as_gas()
            .saturating_add(over.saturating_mul(CALLBACK_GAS_PER_INPUT_BYTE)),
    )
}

#[near]
impl MockOutlayer {
    #[init]
    pub fn new() -> Self {
        Self {
            requests: IterableMap::new(StorageKey::Requests),
            next_id: 0,
        }
    }

    /// Same signature as OutLayer's. Records the request and returns the yield promise.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<Value>,
        input_data: Option<String>,
        secrets_ref: Option<Value>,
        response_format: Option<String>,
        payer_account_id: Option<AccountId>,
        params: Option<Value>,
    ) {
        // The real contract treats a request without limits as compile-only; we never send one.
        require!(
            resource_limits.is_some(),
            "mock: compile-only requests are not supported"
        );
        require!(params.is_none(), "mock: params are not used");
        let request_id = self.next_id;
        self.next_id += 1;
        let input_len = input_data.as_ref().map_or(0, String::len);
        let promise = env::promise_yield_create(
            "on_execution_response",
            json!({"request_id": request_id}).to_string(),
            response_gas(input_len),
            GasWeight(0),
            DATA_ID_REGISTER,
        );
        let data_id = env::read_register(DATA_ID_REGISTER)
            .unwrap_or_else(|| env::panic_str("mock: no data id"));
        let caller = env::predecessor_account_id();
        self.requests.insert(
            request_id,
            Request {
                request_id,
                caller: caller.clone(),
                source: source.to_string(),
                resource_limits: resource_limits.map(|v| v.to_string()).unwrap_or_default(),
                input_data,
                secrets_ref: secrets_ref.map(|v| v.to_string()).unwrap_or_default(),
                response_format: response_format.unwrap_or_else(|| "Text".into()),
                payer_account_id: payer_account_id.unwrap_or(caller),
                deposit: U128(env::attached_deposit().as_yoctonear()),
                data_id,
                resolved: false,
            },
        );
        env::promise_return(promise);
    }

    /// Test driver, playing the TEE: `Some(stdout)` for a run that printed `stdout`, `None` for a
    /// failed run. Each request can be resolved once.
    pub fn resolve(&mut self, request_id: u64, output: Option<String>) -> bool {
        let req = self
            .requests
            .get_mut(&request_id)
            .unwrap_or_else(|| env::panic_str("mock: no such request"));
        require!(!req.resolved, "mock: request already resolved");
        req.resolved = true;
        let data_id: [u8; 32] = req
            .data_id
            .clone()
            .try_into()
            .unwrap_or_else(|_| env::panic_str("mock: bad data id"));
        let payload = serde_json::to_vec(&output).unwrap_or_default();
        env::promise_yield_resume(&data_id, payload)
    }

    /// Resume callback. Returns what the real contract returns for the `Text` format.
    #[private]
    pub fn on_execution_response(&mut self, request_id: u64) {
        let output: Option<String> = env::promise_result_checked(0, 1 << 20)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Option<String>>(&bytes).ok())
            .flatten();
        let out = match output {
            Some(text) => serde_json::to_vec(&text).unwrap_or_else(|_| b"null".to_vec()),
            None => b"null".to_vec(),
        };
        env::log_str(&format!("mock: request {request_id} answered"));
        env::value_return(&out);
    }

    pub fn get_request(&self, request_id: u64) -> Option<Request> {
        self.requests.get(&request_id).cloned()
    }

    pub fn get_requests(&self) -> Vec<Request> {
        self.requests.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_gas_matches_outlayer() {
        assert_eq!(response_gas(100), MIN_RESPONSE_GAS);
        assert_eq!(
            response_gas(INPUT_DATA_FREE_BYTES + 1_000),
            Gas::from_gas(50_000_000_000_000 + 25_000_000_000)
        );
    }
}
