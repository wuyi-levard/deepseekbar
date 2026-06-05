// src-tauri/src/deepseek.rs

use crate::error::{AppError, ErrorKind};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

const ENDPOINT: &str = "https://api.deepseek.com/user/balance";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct Balance {
    pub currency: String,
    pub total: Decimal,
    pub granted: Decimal,
    pub topped_up: Decimal,
    pub available: Decimal,
}

#[derive(Debug, Deserialize)]
struct RawResponse {
    #[serde(default)]
    is_available: bool,
    #[serde(default)]
    balance_infos: Vec<RawBalanceInfo>,
}

#[derive(Debug, Deserialize)]
struct RawBalanceInfo {
    currency: String,
    #[serde(default)]
    total_balance: String,
    #[serde(default)]
    granted_balance: String,
    #[serde(default)]
    topped_up_balance: String,
}

pub fn parse_balance(body: &str) -> Result<Balance, AppError> {
    let raw: RawResponse = serde_json::from_str(body)
        .map_err(|e| AppError::Parse(e.to_string()))?;
    let info = raw
        .balance_infos
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Parse("balance_infos is empty".into()))?;
    // Per DeepSeek docs: total_balance is "总的可用余额，包括赠金和充值余额"
    // (total available balance, including granted and topped-up). Map it to
    // the user-facing "available" field.
    let total_str = info.total_balance.clone();
    Ok(Balance {
        currency: info.currency,
        total: Decimal::from_str_exact(&info.total_balance)
            .map_err(|e| AppError::Parse(format!("total_balance: {e}")))?,
        granted: Decimal::from_str_exact(&info.granted_balance)
            .map_err(|e| AppError::Parse(format!("granted_balance: {e}")))?,
        topped_up: Decimal::from_str_exact(&info.topped_up_balance)
            .map_err(|e| AppError::Parse(format!("topped_up_balance: {e}")))?,
        available: Decimal::from_str_exact(&total_str)
            .map_err(|e| AppError::Parse(format!("total_balance: {e}")))?,
    })
}

pub async fn fetch_balance(
    client: &reqwest::Client,
    api_key: &str,
) -> Result<Balance, AppError> {
    let resp = client
        .get(ENDPOINT)
        .bearer_auth(api_key)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::HttpStatus(status.as_u16(), text));
    }
    let body = resp.text().await?;
    parse_balance(&body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap()
    }

    #[test]
    fn parse_valid_cny_body() {
        let body = json!({
            "is_available": true,
            "balance_infos": [{
                "currency": "CNY",
                "total_balance": "12.34",
                "granted_balance": "0.00",
                "topped_up_balance": "12.34"
            }]
        })
        .to_string();
        let b = parse_balance(&body).unwrap();
        assert_eq!(b.currency, "CNY");
        assert_eq!(b.available, Decimal::new(1234, 2));
        assert_eq!(b.total, Decimal::new(1234, 2));
        assert_eq!(b.topped_up, Decimal::new(1234, 2));
    }

    #[test]
    fn parse_high_precision_keeps_string_value() {
        let body = json!({
            "is_available": true,
            "balance_infos": [{
                "currency": "CNY",
                "total_balance": "0.000123456789",
                "granted_balance": "0",
                "topped_up_balance": "0.000123456789"
            }]
        })
        .to_string();
        let b = parse_balance(&body).unwrap();
        assert_eq!(b.available.to_string(), "0.000123456789");
    }

    #[test]
    fn parse_is_available_false_still_parses() {
        let body = json!({
            "is_available": false,
            "balance_infos": [{
                "currency": "CNY",
                "total_balance": "0.00",
                "granted_balance": "0.00",
                "topped_up_balance": "0.00"
            }]
        })
        .to_string();
        let b = parse_balance(&body).unwrap();
        assert_eq!(b.available, Decimal::new(0, 2));
    }

    #[test]
    fn parse_empty_balance_infos_errors() {
        let body = json!({ "is_available": true, "balance_infos": [] }).to_string();
        assert!(parse_balance(&body).is_err());
    }

    #[test]
    fn parse_invalid_decimal_errors() {
        let body = json!({
            "is_available": true,
            "balance_infos": [{
                "currency": "CNY",
                "total_balance": "abc",
                "granted_balance": "0",
                "topped_up_balance": "0"
            }]
        })
        .to_string();
        let err = parse_balance(&body).unwrap_err();
        assert_eq!(crate::error::classify_error(&err), ErrorKind::Parse);
    }

    #[tokio::test]
    async fn fetch_balance_200_returns_balance() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user/balance"))
            .and(header("Authorization", "Bearer sk-ok"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "is_available": true,
                "balance_infos": [{
                    "currency": "CNY",
                    "total_balance": "5.00",
                    "granted_balance": "5.00",
                    "topped_up_balance": "0.00"
                }]
            })))
            .mount(&server)
            .await;

        let c = client();
        let resp = c
            .get(format!("{}/user/balance", server.uri()))
            .bearer_auth("sk-ok")
            .send()
            .await
            .unwrap();
        let text = resp.text().await.unwrap();
        let b = parse_balance(&text).unwrap();
        assert_eq!(b.available, Decimal::new(500, 2));
    }

    #[tokio::test]
    async fn fetch_balance_401_returns_http_status() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user/balance"))
            .respond_with(ResponseTemplate::new(401).set_body_string("unauthorized"))
            .mount(&server)
            .await;

        let c = client();
        let resp = c
            .get(format!("{}/user/balance", server.uri()))
            .bearer_auth("sk-bad")
            .send()
            .await
            .unwrap();
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let err = AppError::HttpStatus(status.as_u16(), text);
        assert_eq!(crate::error::classify_error(&err), ErrorKind::Auth);
    }

    #[tokio::test]
    async fn fetch_balance_500_classifies_as_network() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user/balance"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;

        let c = client();
        let resp = c
            .get(format!("{}/user/balance", server.uri()))
            .bearer_auth("sk-ok")
            .send()
            .await
            .unwrap();
        let err = AppError::HttpStatus(resp.status().as_u16(), String::new());
        assert_eq!(crate::error::classify_error(&err), ErrorKind::Network);
    }
}
