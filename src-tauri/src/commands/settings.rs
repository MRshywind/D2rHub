use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

use crate::commands::account::AccountManager;
use crate::error::AppError;
use crate::state::SharedState;

fn read_settings_file(path: &Path) -> Result<HashMap<String, Value>, AppError> {
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = std::fs::read_to_string(path)?;
    let map: HashMap<String, Value> = serde_json::from_str(&content)?;
    Ok(map)
}

/// 获取指定账号的 Settings.json 内容
#[tauri::command]
pub fn get_account_settings(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> Result<HashMap<String, Value>, AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let settings_path =
        AccountManager::account_dir_checked(&cfg.accounts_dir, &account_id)?.join("Settings.json");

    if let Ok(meta) = AccountManager::load_meta(&cfg.accounts_dir, &account_id) {
        if !meta.has_customized_settings {
            let system_settings_path = Path::new(&cfg.saved_games_path).join("Settings.json");
            let system_settings = read_settings_file(&system_settings_path)?;
            if !system_settings.is_empty() {
                return Ok(system_settings);
            }
        }
    }

    read_settings_file(&settings_path)
}

/// 保存指定账号的 Settings.json
#[tauri::command]
pub fn save_account_settings(
    state: tauri::State<'_, SharedState>,
    account_id: String,
    settings: HashMap<String, Value>,
) -> Result<(), AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let settings_path =
        AccountManager::account_dir_checked(&cfg.accounts_dir, &account_id)?.join("Settings.json");

    let content = serde_json::to_string_pretty(&settings)?;
    std::fs::write(&settings_path, content)?;

    let mut meta = AccountManager::load_meta(&cfg.accounts_dir, &account_id)?;
    meta.has_customized_settings = true;
    AccountManager::save_meta(&cfg.accounts_dir, &meta)?;
    Ok(())
}

/// 将系统 Saved Games 下的 Settings.json 快照到指定账号
#[tauri::command]
pub fn snapshot_system_settings_to_account(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> Result<HashMap<String, Value>, AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let src = Path::new(&cfg.saved_games_path).join("Settings.json");
    if !src.exists() {
        return Err(AppError::FileError(format!(
            "系统 Settings.json 不存在: {}",
            src.to_string_lossy()
        )));
    }

    let settings = read_settings_file(&src)?;
    let account_dir = AccountManager::account_dir_checked(&cfg.accounts_dir, &account_id)?;
    if !account_dir.exists() {
        std::fs::create_dir_all(&account_dir)?;
    }

    let dst = account_dir.join("Settings.json");
    std::fs::write(&dst, serde_json::to_string_pretty(&settings)?)?;

    let mut meta = AccountManager::load_meta(&cfg.accounts_dir, &account_id)?;
    meta.has_customized_settings = true;
    AccountManager::save_meta(&cfg.accounts_dir, &meta)?;

    Ok(settings)
}

/// 获取游戏安装目录下的 Settings.json（如果存在，用于对比）
#[tauri::command]
pub fn get_game_settings(
    state: tauri::State<'_, SharedState>,
) -> Result<HashMap<String, Value>, AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let path = Path::new(&cfg.saved_games_path).join("Settings.json");
    read_settings_file(&path)
}
