// src-tauri/src/error.rs
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("http status {0}: {1}")]
    HttpStatus(u16, String),
    #[error("request timed out")]
    Timeout,
    #[error("connect error: {0}")]
    Connect(String),
    #[error("response parse error: {0}")]
    Parse(String),
    #[error("keyring error: {0}")]
    Keyring(String),
    #[error("sqlite error: {0}")]
    Sqlite(String),
    #[error("serde error: {0}")]
    Serde(String),
    #[error("other: {0}")]
    Other(String),
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ErrorKind {
    Auth,
    Network,
    Parse,
    Internal,
}

pub fn classify_error(e: &AppError) -> ErrorKind {
    match e {
        AppError::HttpStatus(401, _) | AppError::HttpStatus(403, _) => ErrorKind::Auth,
        AppError::Keyring(_) => ErrorKind::Auth,
        AppError::HttpStatus(500..=599, _) => ErrorKind::Network,
        AppError::Timeout | AppError::Connect(_) => ErrorKind::Network,
        AppError::Parse(_) => ErrorKind::Parse,
        AppError::Sqlite(_) | AppError::Serde(_) | AppError::Other(_) => ErrorKind::Internal,
        // 2xx non-200 and 4xx other than 401/403 fall to internal until we know better
        AppError::HttpStatus(_, _) => ErrorKind::Internal,
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            AppError::Timeout
        } else if e.is_connect() {
            AppError::Connect(e.to_string())
        } else {
            AppError::Other(e.to_string())
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Sqlite(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Serde(e.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Keyring(e.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_401_as_auth() {
        let e = AppError::HttpStatus(401, "unauthorized".into());
        assert_eq!(classify_error(&e), ErrorKind::Auth);
    }

    #[test]
    fn classify_403_as_auth() {
        let e = AppError::HttpStatus(403, "forbidden".into());
        assert_eq!(classify_error(&e), ErrorKind::Auth);
    }

    #[test]
    fn classify_5xx_as_network() {
        let e = AppError::HttpStatus(500, "server error".into());
        assert_eq!(classify_error(&e), ErrorKind::Network);
    }

    #[test]
    fn classify_502_as_network() {
        let e = AppError::HttpStatus(502, "bad gateway".into());
        assert_eq!(classify_error(&e), ErrorKind::Network);
    }

    #[test]
    fn classify_timeout_as_network() {
        let e = AppError::Timeout;
        assert_eq!(classify_error(&e), ErrorKind::Network);
    }

    #[test]
    fn classify_connect_as_network() {
        let e = AppError::Connect("dns".into());
        assert_eq!(classify_error(&e), ErrorKind::Network);
    }

    #[test]
    fn classify_parse_as_parse() {
        let e = AppError::Parse("missing field balance".into());
        assert_eq!(classify_error(&e), ErrorKind::Parse);
    }

    #[test]
    fn classify_keyring_as_auth() {
        let e = AppError::Keyring("not found".into());
        assert_eq!(classify_error(&e), ErrorKind::Auth);
    }

    #[test]
    fn classify_sqlite_as_internal() {
        let e = AppError::Sqlite("db locked".into());
        assert_eq!(classify_error(&e), ErrorKind::Internal);
    }
}
