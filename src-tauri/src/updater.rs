// src-tauri/src/updater.rs — check for new versions via raw JSON
// No GitHub API token needed — reads latest.json from raw.githubusercontent.com

use crate::error::AppError;
use serde::Deserialize;

const VERSION_URL: &str =
    "https://raw.githubusercontent.com/wuyi-levard/deepseekbar/main/latest.json";

const RELEASES_URL: &str = "https://github.com/wuyi-levard/deepseekbar/releases/latest";

#[derive(Debug, Deserialize)]
struct LatestJson {
    version: String,
}

/// Compare two semver strings.
fn is_newer(latest: &str, current: &str) -> bool {
    fn parse(v: &str) -> Vec<u32> {
        v.split('.').filter_map(|s| s.parse().ok()).collect()
    }
    parse(latest) > parse(current)
}

/// Fetch latest.json and compare with current version.
/// Returns Some("X.Y.Z") if a newer version exists, or None if up-to-date.
pub async fn check_update(current_version: &str) -> Result<Option<String>, AppError> {
    let client = reqwest::Client::new();
    let resp = client
        .get(VERSION_URL)
        .header("User-Agent", "DeepSeekBar")
        .send()
        .await?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::HttpStatus(status.as_u16(), text));
    }

    let v: LatestJson = resp.json().await.map_err(|e| AppError::Parse(e.to_string()))?;

    if is_newer(&v.version, current_version) {
        Ok(Some(v.version))
    } else {
        Ok(None)
    }
}

/// Return the URL to open when the user wants to download the update.
pub fn releases_url() -> &'static str {
    RELEASES_URL
}
