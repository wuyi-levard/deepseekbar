// src-tauri/src/updater.rs — online update via GitHub Releases

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Emitter;

const REPO: &str = "wuyi-levard/deepseekbar";
const USER_AGENT: &str = "DeepSeekBar (Windows desktop app)";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub tag_name: String,
    pub body: String,
    pub download_url: String,
    pub size: u64,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

/// Compare two semver strings (e.g. "0.1.2" vs "0.2.0").
fn is_newer(latest: &str, current: &str) -> bool {
    fn parse(v: &str) -> Vec<u32> {
        v.split('.').filter_map(|s| s.parse().ok()).collect()
    }
    let a = parse(latest);
    let b = parse(current);
    a > b
}

/// Query GitHub Releases API. Returns Some(UpdateInfo) if a newer version
/// exists, or None if the current version is already the latest.
pub async fn check_update(current_version: &str) -> Result<Option<UpdateInfo>, AppError> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        REPO
    );
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        // Try to extract GitHub error message from JSON body
        let msg = if let Ok(err) = serde_json::from_str::<serde_json::Value>(&text) {
            err.get("message")
                .and_then(|m| m.as_str())
                .unwrap_or(&text)
                .to_string()
        } else {
            text
        };
        return Err(AppError::HttpStatus(status.as_u16(), msg));
    }

    let rel: GhRelease = resp.json().await.map_err(|e| AppError::Parse(e.to_string()))?;
    let tag = rel.tag_name.trim_start_matches('v').to_string();

    if !is_newer(&tag, current_version) {
        return Ok(None);
    }

    // Find the NSIS installer asset
    let asset = rel
        .assets
        .iter()
        .find(|a| a.name.ends_with("_x64-setup.exe"))
        .ok_or_else(|| AppError::Parse("no x64 installer asset found".into()))?;

    Ok(Some(UpdateInfo {
        version: tag,
        tag_name: rel.tag_name,
        body: rel.body.unwrap_or_default(),
        download_url: asset.browser_download_url.clone(),
        size: asset.size,
    }))
}

/// Streaming download with progress events.
/// Returns the path to the downloaded file.
pub async fn download_installer(
    url: &str,
    app: &tauri::AppHandle,
    version: &str,
) -> Result<PathBuf, AppError> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let resp = client.get(url).send().await?;

    let total = resp.content_length().unwrap_or(0);
    let filename = format!("DeepSeekBar_Update_{}_x64-setup.exe", version);
    let dest = std::env::temp_dir().join(&filename);

    let mut downloaded: u64 = 0;
    let mut file = std::fs::File::create(&dest)
        .map_err(|e| AppError::Other(e.to_string()))?;

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let app_clone = app.clone();
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Other(e.to_string()))?;
        use std::io::Write;
        file.write_all(&chunk).map_err(|e| AppError::Other(e.to_string()))?;
        downloaded += chunk.len() as u64;

        // Emit progress at most every 80ms to avoid flooding the frontend
        let now = std::time::Instant::now();
        if now.duration_since(last_emit).as_millis() >= 80 || downloaded >= total {
            last_emit = now;
            let percent = if total > 0 {
                (downloaded * 100 / total) as u32
            } else {
                0
            };
            let _ = app_clone.emit(
                "update:progress",
                serde_json::json!({
                    "downloaded": downloaded,
                    "total": total,
                    "percent": percent,
                }),
            );
        }
    }

    Ok(dest)
}
