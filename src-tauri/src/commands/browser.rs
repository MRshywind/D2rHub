use crate::commands::utils::{silent_cmd, sanitize_folder_name, shared_system};
use crate::error::AppError;
use sysinfo::ProcessesToUpdate;
use crate::commands::account::AccountManager;
use crate::state::SharedState;
use crate::commands::global_config::GlobalConfig;

fn paths_match_config(config_path: &str, requested_path: &str) -> bool {
    let config = std::path::Path::new(config_path);
    let requested = std::path::Path::new(requested_path);
    if config_path.trim().is_empty() || requested_path.trim().is_empty() {
        return false;
    }
    match (config.canonicalize(), requested.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => config_path.eq_ignore_ascii_case(requested_path),
    }
}

fn ensure_browser_path_allowed(config: &GlobalConfig, browser_path: &str) -> Result<(), AppError> {
    if !paths_match_config(&config.browser_path, browser_path) {
        return Err(AppError::FileError(
            "浏览器路径必须使用已保存的全局配置".to_string(),
        ));
    }
    Ok(())
}

fn ensure_allowed_bnet_login_url(url: &str) -> Result<(), AppError> {
    let lower = url.to_lowercase();
    let allowed_prefixes = [
        "https://kr.battle.net/login/",
        "https://us.battle.net/login/",
        "https://eu.battle.net/login/",
        "https://account.battlenet.com.cn/login/",
    ];
    let allowed_host = allowed_prefixes
        .iter()
        .any(|prefix| lower.starts_with(prefix));
    let expected_query = lower.contains("externalchallenge=login") && lower.contains("app=osi");
    if allowed_host && expected_query {
        Ok(())
    } else {
        Err(AppError::FileError(
            "仅允许打开 Battle.net Token 登录页面".to_string(),
        ))
    }
}

/// 强行修改浏览器 Preferences 中的个人资料名称，解决 Chrome 自动命名为 “您的 Chrome” 或 “用户X” 的问题
fn set_profile_name(user_data_dir: &std::path::Path, profile_name: &str, display_name: &str) {
    let pref_path = user_data_dir.join(profile_name).join("Preferences");
    if let Some(parent) = pref_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut prefs = if pref_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&pref_path) {
            serde_json::from_str::<serde_json::Value>(&content).unwrap_or(serde_json::Value::Object(serde_json::Map::new()))
        } else {
            serde_json::Value::Object(serde_json::Map::new())
        }
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    };

    if let Some(obj) = prefs.as_object_mut() {
        let profile_obj = obj.entry("profile").or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
        if let Some(p_obj) = profile_obj.as_object_mut() {
            p_obj.insert("name".to_string(), serde_json::Value::String(display_name.to_string()));
            p_obj.insert("is_using_default_name".to_string(), serde_json::Value::Bool(false));
        }
    }

    if let Ok(serialized) = serde_json::to_string_pretty(&prefs) {
        let _ = std::fs::write(&pref_path, serialized);
    }
}

pub fn launch_browser_for_account_impl(
    config: &GlobalConfig,
    browser_path: &str,
    account_id: &str,
) -> Result<(), AppError> {
    AccountManager::validate_account_id(account_id)?;
    ensure_browser_path_allowed(config, browser_path)?;

    let browser_type = if config.browser_type.is_empty() {
        let path_lower = browser_path.to_lowercase();
        if path_lower.contains("msedge") {
            "edge"
        } else if path_lower.contains("chrome") {
            "chrome"
        } else {
            "chrome"
        }
    } else {
        config.browser_type.as_str()
    };

    // 获取账号昵称，用于命名浏览器用户配置文件目录
    let display_name = if let Ok(meta) = AccountManager::load_meta(&config.accounts_dir, account_id) {
        meta.display_name
    } else {
        account_id.to_string()
    };

    let sanitized_name = sanitize_folder_name(&display_name);

    let (user_data_dir, profile_name) = if let Some(local_dir) = dirs::data_local_dir() {
        if browser_type == "edge" {
            (
                local_dir.join("Microsoft").join("Edge").join("User Data"),
                sanitized_name,
            )
        } else {
            (
                local_dir.join("Google").join("Chrome").join("User Data"),
                sanitized_name,
            )
        }
    } else {
        let account_dir = AccountManager::account_dir_checked(&config.accounts_dir, account_id)?;
        (
            account_dir.join("BrowserProfile"),
            "Default".to_string(),
        )
    };

    let profile_path = user_data_dir.join(&profile_name);
    let _ = std::fs::create_dir_all(&profile_path);

    // 强行在启动前修改个人资料名字，避免显示 “您的 Chrome / 用户 2”
    if profile_name != "Default" {
        set_profile_name(&user_data_dir, &profile_name, &display_name);
    }

    let user_data_arg = format!("--user-data-dir={}", user_data_dir.to_string_lossy());
    let profile_dir_arg = format!("--profile-directory={}", profile_name);

    let args = vec![
        user_data_arg,
        profile_dir_arg,
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string()
    ];

    let _ = silent_cmd(browser_path)
        .args(&args)
        .spawn()
        .map_err(|e| AppError::FileError(format!("启动浏览器失败: {}", e)))?;

    Ok(())
}

/// 启动浏览器，将用户数据目录强制定向到账号专用的配置文件夹内
#[tauri::command]
pub fn launch_browser_for_account(
    state: tauri::State<'_, SharedState>,
    browser_path: String,
    account_id: String,
) -> Result<(), AppError> {
    let config_lock = state.config.read();
    let config = config_lock.as_ref()
        .ok_or_else(|| AppError::ConfigReadError("未配置".into()))?;

    // 在启动浏览器之前，收集现有的 Chrome/Edge 窗口句柄列表
    #[cfg(target_os = "windows")]
    let before_hwnds = crate::commands::system::collect_chrome_windows();

    launch_browser_for_account_impl(config, &browser_path, &account_id)?;

    // 启动后台监测线程，自动将新打开的浏览器空白窗口置顶并激活
    #[cfg(target_os = "windows")]
    crate::commands::system::bring_browser_login_to_foreground(before_hwnds);

    Ok(())
}

/// 检测指定类型的浏览器（chrome/edge）是否正在运行
#[tauri::command]
pub fn check_browser_running(browser_type: String) -> bool {
    let target = if browser_type == "edge" {
        "msedge"
    } else {
        "chrome"
    };
    let mut sys = shared_system().lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_processes(ProcessesToUpdate::All);
    for proc in sys.processes().values() {
        let name = proc.name().to_string_lossy().to_lowercase();
        if name.contains(target) {
            return true;
        }
    }
    false
}

/// 强行杀死同名浏览器的所有进程（已重定向为安全的窗口点杀，避免关闭默认浏览器）
#[tauri::command]
pub fn kill_browser_processes(_browser_type: String) {
    #[cfg(target_os = "windows")]
    {
        crate::commands::account::close_browser_for_profile_cmd("".to_string());
    }
}

/// 使用账号对应的浏览器配置文件打开指定 URL
fn open_url_for_account_impl(
    config: &GlobalConfig,
    browser_path: &str,
    account_id: &str,
    url: &str,
) -> Result<(), AppError> {
    AccountManager::validate_account_id(account_id)?;

    let browser_type = if config.browser_type.is_empty() {
        let path_lower = browser_path.to_lowercase();
        if path_lower.contains("msedge") {
            "edge"
        } else if path_lower.contains("chrome") {
            "chrome"
        } else {
            "chrome"
        }
    } else {
        config.browser_type.as_str()
    };

    let display_name = if let Ok(meta) = AccountManager::load_meta(&config.accounts_dir, account_id) {
        meta.display_name
    } else {
        account_id.to_string()
    };

    let sanitized_name = sanitize_folder_name(&display_name);

    let (user_data_dir, profile_name) = if let Some(local_dir) = dirs::data_local_dir() {
        if browser_type == "edge" {
            (
                local_dir.join("Microsoft").join("Edge").join("User Data"),
                sanitized_name,
            )
        } else {
            (
                local_dir.join("Google").join("Chrome").join("User Data"),
                sanitized_name,
            )
        }
    } else {
        let account_dir = AccountManager::account_dir_checked(&config.accounts_dir, account_id)?;
        (
            account_dir.join("BrowserProfile"),
            "Default".to_string(),
        )
    };

    let profile_path = user_data_dir.join(&profile_name);
    let _ = std::fs::create_dir_all(&profile_path);

    if profile_name != "Default" {
        set_profile_name(&user_data_dir, &profile_name, &display_name);
    }

    let user_data_arg = format!("--user-data-dir={}", user_data_dir.to_string_lossy());
    let profile_dir_arg = format!("--profile-directory={}", profile_name);

    let args = vec![
        user_data_arg,
        profile_dir_arg,
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        url.to_string(),
    ];

    let _ = silent_cmd(browser_path)
        .args(&args)
        .spawn()
        .map_err(|e| AppError::FileError(format!("启动浏览器失败: {}", e)))?;

    Ok(())
}

/// 启动浏览器并用账号对应的配置文件打开指定 URL
#[tauri::command]
pub fn open_url_in_browser(
    state: tauri::State<'_, SharedState>,
    browser_path: String,
    account_id: String,
    url: String,
) -> Result<(), AppError> {
    let config_lock = state.config.read();
    let config = config_lock.as_ref()
        .ok_or_else(|| AppError::ConfigReadError("未配置".into()))?;

    #[cfg(target_os = "windows")]
    let before_hwnds = crate::commands::system::collect_chrome_windows();

    ensure_browser_path_allowed(config, &browser_path)?;
    ensure_allowed_bnet_login_url(&url)?;

    open_url_for_account_impl(config, &config.browser_path, &account_id, &url)?;

    #[cfg(target_os = "windows")]
    crate::commands::system::bring_browser_login_to_foreground(before_hwnds);

    Ok(())
}
