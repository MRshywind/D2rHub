use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Emitter;

use crate::commands::utils::{kill_processes_by_name, shared_system};
use crate::error::AppError;
use crate::state::SharedState;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RegistryValueBackup {
    pub name: String,
    pub value_type: u32,
    pub value_bytes: Vec<u8>,
}

fn backup_registry_to_json(json_path: &Path) -> Result<(), AppError> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key_res = hkcu.open_subkey_with_flags(
        r"Software\Blizzard Entertainment\Battle.net\UnifiedAuth",
        KEY_READ,
    );

    let mut backups = Vec::new();

    if let Ok(key) = key_res {
        for val_res in key.enum_values() {
            if let Ok((name, raw_val)) = val_res {
                backups.push(RegistryValueBackup {
                    name,
                    value_type: raw_val.vtype as u32,
                    value_bytes: raw_val.bytes,
                });
            }
        }
    }

    let serialized = serde_json::to_string_pretty(&backups)
        .map_err(|e| AppError::FileError(format!("序列化注册表备份失败: {}", e)))?;
    std::fs::write(json_path, serialized)?;

    Ok(())
}

pub(crate) fn restore_registry_from_json(json_path: &Path) -> Result<(), AppError> {
    use winreg::enums::*;
    use winreg::{RegKey, RegValue};

    if !json_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(json_path)?;
    let backups: Vec<RegistryValueBackup> = serde_json::from_str(&content)
        .map_err(|e| AppError::FileError(format!("反序列化注册表备份失败: {}", e)))?;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(r"Software\Blizzard Entertainment\Battle.net\UnifiedAuth")
        .map_err(|e| AppError::RegistryError(format!("创建/打开注册表键失败: {}", e)))?;

    for item in backups {
        let val = RegValue {
            bytes: item.value_bytes,
            vtype: match item.value_type {
                1 => RegType::REG_SZ,
                2 => RegType::REG_EXPAND_SZ,
                3 => RegType::REG_BINARY,
                4 => RegType::REG_DWORD,
                5 => RegType::REG_DWORD_BIG_ENDIAN,
                7 => RegType::REG_MULTI_SZ,
                _ => RegType::REG_BINARY,
            },
        };
        key.set_raw_value(&item.name, &val).map_err(|e| {
            AppError::RegistryError(format!("写入注册表值 {} 失败: {}", item.name, e))
        })?;
    }

    Ok(())
}

/// 账号元信息（存储在 accounts/{id}/account.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountMeta {
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub mod_args: String,
    #[serde(default)]
    pub mod_list: Vec<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub last_launched_at: Option<String>,
    #[serde(default)]
    pub initialized: bool,
    /// 最后一次初始化/重置的时间（用于 token 有效期计算）
    #[serde(default)]
    pub last_reset_at: Option<String>,
    #[serde(default)]
    pub order: u32,
    #[serde(default)]
    pub is_running: bool,
    /// 当前运行中的 D2R 进程 PID（None = 未运行）
    #[serde(default)]
    pub running_pid: Option<u32>,
    /// 游戏窗口目标 X 坐标（None = 不调整位置）
    #[serde(default)]
    pub window_x: Option<i32>,
    /// 游戏窗口目标 Y 坐标（None = 不调整位置）
    #[serde(default)]
    pub window_y: Option<i32>,
    /// 认证模式 ("bnet" 或 "token")
    #[serde(default)]
    pub auth_mode: Option<String>,
    /// Token 认证的区服 ("CN" 或 "Global")
    #[serde(default)]
    pub region: Option<String>,
    /// 用户填写的原始 Token（保存为明文，或者也可以在加密后存，但最好只存明文或 DPAPI 加密结果）
    #[serde(default)]
    pub token: Option<String>,
    /// 是否已自定义过设置
    #[serde(default)]
    pub has_customized_settings: bool,
    /// 界面语言 ("zhCN" / "zhTW" / "enUS"，默认取决于区服)
    #[serde(default)]
    pub language: Option<String>,
    /// 配音语言 ("zhCN" / "zhTW" / "enUS"，默认取决于区服)
    #[serde(default)]
    pub voicelanguage: Option<String>,
}

impl AccountMeta {
    pub fn new(id: &str) -> Self {
        Self {
            id: id.to_string(),
            display_name: String::new(),
            mod_args: String::new(),
            mod_list: Vec::new(),
            created_at: chrono::Utc::now().to_rfc3339(),
            last_launched_at: None,
            initialized: false,
            last_reset_at: None,
            order: 0,
            is_running: false,
            running_pid: None,
            window_x: None,
            window_y: None,
            auth_mode: None,
            region: None,
            token: None,
            has_customized_settings: false,
            language: None,
            voicelanguage: None,
        }
    }
}

pub struct AccountManager;

impl AccountManager {
    pub fn is_valid_account_id(id: &str) -> bool {
        if id.is_empty()
            || id == "."
            || id == ".."
            || id.contains('\\')
            || id.contains('/')
            || id.contains(':')
        {
            return false;
        }

        if let Some(rest) = id.strip_prefix("acount") {
            return !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit());
        }

        let parts: Vec<&str> = id.split('-').collect();
        if parts.len() == 5 {
            let expected = [8, 4, 4, 4, 12];
            return parts
                .iter()
                .zip(expected)
                .all(|(part, len)| part.len() == len && part.chars().all(|c| c.is_ascii_hexdigit()));
        }

        false
    }

    pub fn validate_account_id(id: &str) -> Result<(), AppError> {
        if Self::is_valid_account_id(id) {
            Ok(())
        } else {
            Err(AppError::FileError(format!("账号 ID 非法: {}", id)))
        }
    }

    /// 获取账号目录路径
    pub fn account_dir_checked(accounts_dir: &str, id: &str) -> Result<PathBuf, AppError> {
        Self::validate_account_id(id)?;
        if accounts_dir.trim().is_empty() {
            return Err(AppError::FileError("账号根目录为空".to_string()));
        }

        let root = Path::new(accounts_dir);
        let root_abs = if root.exists() {
            root.canonicalize()?
        } else if root.is_absolute() {
            root.to_path_buf()
        } else {
            std::env::current_dir()?.join(root)
        };
        let dir = root_abs.join(id);
        if !dir.starts_with(&root_abs) {
            return Err(AppError::FileError(format!("账号目录越界: {}", id)));
        }
        Ok(dir)
    }

    /// 加载单个账号的元信息
    pub fn load_meta(accounts_dir: &str, id: &str) -> Result<AccountMeta, AppError> {
        let path = Self::account_dir_checked(accounts_dir, id)?.join("account.json");
        if !path.exists() {
            return Err(AppError::AccountNotFound(id.to_string()));
        }
        let content = std::fs::read_to_string(&path)?;
        let mut meta: AccountMeta = serde_json::from_str(&content)?;

        // --- 兼容性适配 ---
        // 仅当 mod_list 为空（旧版本单 mod 格式）时，将 mod_args 迁移到 mod_list
        if meta.mod_list.is_empty() && !meta.mod_args.trim().is_empty() {
            meta.mod_list.push(meta.mod_args.clone());
            // 确保 active mod 与列表一致
            if !meta.mod_list.contains(&meta.mod_args) {
                meta.mod_args = meta.mod_list[0].clone();
            }
        }

        Ok(meta)
    }

    /// 保存账号元信息
    pub fn save_meta(accounts_dir: &str, meta: &AccountMeta) -> Result<(), AppError> {
        let dir = Self::account_dir_checked(accounts_dir, &meta.id)?;
        if !dir.exists() {
            std::fs::create_dir_all(&dir)?;
        }
        let path = dir.join("account.json");
        let content = serde_json::to_string_pretty(meta)?;
        std::fs::write(&path, content)?;
        Ok(())
    }

    /// 列出所有已存在的账号 ID（通过扫描 accounts 目录）
    pub fn list_ids(accounts_dir: &str) -> Vec<String> {
        let dir = Path::new(accounts_dir);
        if !dir.exists() {
            return vec![];
        }
        let mut ids: Vec<String> = vec![];
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if Self::is_valid_account_id(&name) {
                        ids.push(name);
                    }
                }
            }
        }
        ids.sort();
        ids
    }

    /// 获取下一个可用的账号 ID
    pub fn next_id(accounts_dir: &str) -> String {
        let existing = Self::list_ids(accounts_dir);
        let mut max_n = 0;
        for id in &existing {
            if let Some(num_str) = id.strip_prefix("acount") {
                if let Ok(n) = num_str.parse::<u32>() {
                    max_n = max_n.max(n);
                }
            }
        }
        format!("acount{}", max_n + 1)
    }
}

pub(crate) fn copy_system_settings_to_account_if_available(
    saved_games_path: &Path,
    account_dir: &Path,
) -> Result<bool, AppError> {
    let src = saved_games_path.join("Settings.json");
    if !src.is_file() {
        return Ok(false);
    }

    if !account_dir.exists() {
        std::fs::create_dir_all(account_dir)?;
    }

    std::fs::copy(&src, account_dir.join("Settings.json"))
        .map_err(|e| AppError::FileError(format!("复制 Settings.json 失败: {}", e)))?;
    Ok(true)
}

pub(crate) fn copy_account_settings_to_system(
    account_dir: &Path,
    saved_games_path: &Path,
) -> Result<(), AppError> {
    let src = account_dir.join("Settings.json");
    if !src.is_file() {
        return Err(AppError::FileError(format!(
            "账号 Settings.json 不存在: {}。请先在画质配置中从系统配置创建账号独立配置",
            src.display()
        )));
    }
    if !saved_games_path.is_dir() {
        return Err(AppError::FileError(format!(
            "存档目录无效: {}。请在设置中修正存档目录",
            saved_games_path.display()
        )));
    }

    std::fs::copy(&src, saved_games_path.join("Settings.json"))
        .map_err(|e| AppError::FileError(format!("复制 Settings.json 失败: {}", e)))?;
    Ok(())
}

// ── Tauri Commands ──

/// 获取所有账号列表
#[tauri::command]
pub fn list_accounts(state: tauri::State<'_, SharedState>) -> Result<Vec<AccountMeta>, AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let ids = AccountManager::list_ids(&cfg.accounts_dir);
    let mut accounts = Vec::new();

    let mut sys = shared_system().lock().unwrap_or_else(|e| e.into_inner());

    for id in &ids {
        if let Ok(mut meta) = AccountManager::load_meta(&cfg.accounts_dir, id) {
            // 从 Battle.net.config 同步 Mod 启动参数（内存中更新，不写回磁盘）
            if meta.initialized {
                let bnet_config = AccountManager::account_dir_checked(&cfg.accounts_dir, id)?
                    .join("Battle.net")
                    .join("Battle.net.config");
                if bnet_config.exists() {
                    if let Some(args) = read_mod_args_from_config(&bnet_config) {
                        if meta.mod_args != args {
                            meta.mod_args = args;
                        }
                    } else if !meta.mod_args.is_empty() {
                        meta.mod_args = String::new();
                    }
                }
            }
            let pid = {
                let active = state.active_games.read();
                active.get(id).copied()
            };
            let mut running = false;
            if let Some(pid) = pid {
                let sys_pid = sysinfo::Pid::from(pid as usize);
                sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[sys_pid]));
                if let Some(proc) = sys.process(sys_pid) {
                    let name = proc.name().to_string_lossy();
                    if name.eq_ignore_ascii_case("D2R.exe") {
                        running = true;
                    }
                }
            }
            if !running && pid.is_some() {
                let mut active = state.active_games.write();
                active.remove(id);
            }
            meta.is_running = running;
            meta.running_pid = if running { pid } else { None };
            accounts.push(meta);
        }
    }
    Ok(accounts)
}

/// 重新排序账号（更新 order 字段）
#[tauri::command]
pub fn reorder_accounts(
    state: tauri::State<'_, SharedState>,
    ordered_ids: Vec<String>,
) -> Result<(), AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    for id in &ordered_ids {
        AccountManager::validate_account_id(id)?;
    }

    for (i, id) in ordered_ids.iter().enumerate() {
        let mut meta = AccountManager::load_meta(&cfg.accounts_dir, id)?;
        meta.order = i as u32;
        AccountManager::save_meta(&cfg.accounts_dir, &meta)?;
    }
    Ok(())
}

/// 打开账号配置目录（直接用 Explorer 打开）
#[tauri::command]
pub fn open_account_dir(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> Result<(), AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;
    let dir = AccountManager::account_dir_checked(&cfg.accounts_dir, &account_id)?;

    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| AppError::FileError(format!("打开目录失败: {}", e)))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| AppError::FileError(format!("打开目录失败: {}", e)))?;
    }
    Ok(())
}

/// 获取账号配置目录路径
#[tauri::command]
pub fn get_account_dir_path(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> Result<String, AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;
    let dir = AccountManager::account_dir_checked(&cfg.accounts_dir, &account_id)?;
    Ok(dir.to_string_lossy().to_string())
}

/// 获取单个账号信息
#[tauri::command]
pub fn get_account(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> Result<AccountMeta, AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;
    AccountManager::load_meta(&cfg.accounts_dir, &account_id)
}

/// 创建新账号目录并返回 ID
#[tauri::command]
pub fn create_account(
    state: tauri::State<'_, SharedState>,
    nickname: String,
    auth_mode: Option<String>,
    region: Option<String>,
    token: Option<String>,
    language: Option<String>,
    voicelanguage: Option<String>,
) -> Result<String, AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let id = AccountManager::next_id(&cfg.accounts_dir);
    let dir = AccountManager::account_dir_checked(&cfg.accounts_dir, &id)?;
    std::fs::create_dir_all(&dir)?;
    if let Err(error) =
        copy_system_settings_to_account_if_available(Path::new(&cfg.saved_games_path), &dir)
    {
        crate::logger::log_msg(
            "WARN",
            "Account",
            &format!("创建账号时跳过可选 Settings.json 快照: {}", error),
        );
    }

    let mut meta = AccountMeta::new(&id);
    meta.display_name = nickname;
    meta.auth_mode = auth_mode;
    meta.region = region;
    // 语言/配音默认值：国服→zhCN，亚服→zhTW，美/欧服→enUS
    let default_locale = match meta.region.as_deref() {
        Some("KR") => "zhTW",
        Some("NA") | Some("EU") => "enUS",
        Some("Global") => "zhTW",
        _ => "zhCN",
    };
    meta.language = language.or(Some(default_locale.to_string()));
    meta.voicelanguage = voicelanguage.or(Some(default_locale.to_string()));
    // Token 使用 DPAPI 加密后存储，防止明文落盘
    meta.token = if let Some(ref t) = token {
        let encrypted = crate::commands::crypto::protect_token(t)
            .map_err(|e| AppError::Unknown(format!("Token 加密失败: {}", e)))?;
        Some(crate::commands::crypto::hex_encode(&encrypted))
    } else {
        None
    };

    // 对于 Token 认证模式，初始化不需要捕获战网快照。
    if let Some(mode) = &meta.auth_mode {
        if mode == "token" {
            meta.initialized = true; // token 模式天然不需要等待战网登录初始化
        }
    }

    meta.last_reset_at = Some(chrono::Utc::now().to_rfc3339());
    AccountManager::save_meta(&cfg.accounts_dir, &meta)?;

    Ok(id)
}

/// 更新已创建的账号的 Token / 语言 / 区服等字段
#[tauri::command]
pub fn update_account_meta(
    state: tauri::State<'_, SharedState>,
    account_id: String,
    token: Option<String>,
    region: Option<String>,
    language: Option<String>,
    voicelanguage: Option<String>,
) -> Result<(), AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let mut meta = AccountManager::load_meta(&cfg.accounts_dir, &account_id)?;

    if let Some(r) = region {
        meta.region = Some(r);
        // Update locale defaults when region changes
        let default_locale = match meta.region.as_deref() {
            Some("KR") => "zhTW",
            Some("NA") | Some("EU") => "enUS",
            Some("Global") => "zhTW",
            _ => "zhCN",
        };
        if meta.language.is_none() {
            meta.language = Some(default_locale.to_string());
        }
        if meta.voicelanguage.is_none() {
            meta.voicelanguage = Some(default_locale.to_string());
        }
    }
    if let Some(l) = language {
        meta.language = Some(l);
    }
    if let Some(v) = voicelanguage {
        meta.voicelanguage = Some(v);
    }
    if let Some(ref t) = token {
        let encrypted = crate::commands::crypto::protect_token(t)
            .map_err(|e| AppError::Unknown(format!("Token 加密失败: {}", e)))?;
        meta.token = Some(crate::commands::crypto::hex_encode(&encrypted));
    }

    AccountManager::save_meta(&cfg.accounts_dir, &meta)?;
    Ok(())
}

/// 删除账号
#[tauri::command]
pub fn delete_account(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> Result<(), AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let dir = AccountManager::account_dir_checked(&cfg.accounts_dir, &account_id)?;
    if !dir.exists() {
        return Err(AppError::AccountNotFound(account_id));
    }
    std::fs::remove_dir_all(&dir)?;
    Ok(())
}

/// 供前端直接关闭指定浏览器 Profile 的进程
#[tauri::command]
pub fn close_browser_for_profile_cmd(profile_name: String) {
    close_browser_for_profile(&profile_name);
}

/// 重命名账号（修改 display_name 并尝试重命名对应的浏览器用户文件夹）
#[tauri::command]
pub fn rename_account(
    state: tauri::State<'_, SharedState>,
    account_id: String,
    new_name: String,
) -> Result<AccountMeta, AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let mut meta = AccountManager::load_meta(&cfg.accounts_dir, &account_id)?;
    let old_display_name = meta.display_name.clone();

    // 尝试重命名浏览器独立配置文件夹，保持与昵称同步
    let old_profile = crate::commands::utils::sanitize_folder_name(&old_display_name);
    let new_profile = crate::commands::utils::sanitize_folder_name(&new_name);
    if old_profile != new_profile {
        if let Some(local_dir) = dirs::data_local_dir() {
            // Chrome
            let chrome_path = local_dir.join("Google").join("Chrome").join("User Data");
            let old_chrome = chrome_path.join(&old_profile);
            let new_chrome = chrome_path.join(&new_profile);
            if old_chrome.exists() && !new_chrome.exists() {
                let _ = std::fs::rename(&old_chrome, &new_chrome);
            }
            // Edge
            let edge_path = local_dir.join("Microsoft").join("Edge").join("User Data");
            let old_edge = edge_path.join(&old_profile);
            let new_edge = edge_path.join(&new_profile);
            if old_edge.exists() && !new_edge.exists() {
                let _ = std::fs::rename(&old_edge, &new_edge);
            }
        }
    }

    meta.display_name = new_name;
    AccountManager::save_meta(&cfg.accounts_dir, &meta)?;
    Ok(meta)
}

/// 设置账号的多选 Mod 启动参数
#[tauri::command]
pub fn update_account_mods(
    state: tauri::State<'_, SharedState>,
    account_id: String,
    active_mod: String,
    mod_list: Vec<String>,
) -> Result<AccountMeta, AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let mut meta = AccountManager::load_meta(&cfg.accounts_dir, &account_id)?;
    meta.mod_args = active_mod;
    meta.mod_list = mod_list;

    // 先注入 Battle.net.config，再保存 account.json（确保两边一致）
    let bnet_config = AccountManager::account_dir_checked(&cfg.accounts_dir, &account_id)?
        .join("Battle.net")
        .join("Battle.net.config");
    if bnet_config.exists() {
        inject_mod_args(&bnet_config, &meta.mod_args)?;
    }

    AccountManager::save_meta(&cfg.accounts_dir, &meta)?;

    Ok(meta)
}

/// 标记账号已自定义过设置（用于前端引导提示）
#[tauri::command]
pub fn mark_settings_customized(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> Result<(), AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let mut meta = AccountManager::load_meta(&cfg.accounts_dir, &account_id)?;
    meta.has_customized_settings = true;
    AccountManager::save_meta(&cfg.accounts_dir, &meta)?;

    Ok(())
}

/// 设置账号是否使用独立 Settings.json 覆盖系统游戏配置
#[tauri::command]
pub fn set_settings_customized(
    state: tauri::State<'_, SharedState>,
    account_id: String,
    customized: bool,
) -> Result<(), AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let mut meta = AccountManager::load_meta(&cfg.accounts_dir, &account_id)?;
    meta.has_customized_settings = customized;
    AccountManager::save_meta(&cfg.accounts_dir, &meta)?;

    Ok(())
}

/// 设置账号的窗口位置（持久化到 account.json）
#[tauri::command]
pub fn set_account_window_position(
    state: tauri::State<'_, SharedState>,
    account_id: String,
    window_x: Option<i32>,
    window_y: Option<i32>,
) -> Result<AccountMeta, AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let mut meta = AccountManager::load_meta(&cfg.accounts_dir, &account_id)?;
    meta.window_x = window_x;
    meta.window_y = window_y;
    AccountManager::save_meta(&cfg.accounts_dir, &meta)?;
    Ok(meta)
}

/// 从 Battle.net.config 的 Games.osic.AdditionalLaunchArguments 读取 Mod 参数
fn read_mod_args_from_config(config_path: &Path) -> Option<String> {
    if !config_path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    let args = config
        .as_object()?
        .get("Games")?
        .as_object()?
        .get("osic")?
        .as_object()?
        .get("AdditionalLaunchArguments")?
        .as_str()?;
    Some(args.to_string())
}

/// 将 Mod 参数注入 Battle.net.config 的 Games.osic.AdditionalLaunchArguments
pub(crate) fn inject_mod_args(config_path: &Path, mod_args: &str) -> Result<(), AppError> {
    let content = std::fs::read_to_string(config_path)?;
    let mut config: serde_json::Value = serde_json::from_str(&content)?;

    // 确保 Games.osic 路径存在，如不存在则创建
    let games = config.as_object_mut().ok_or_else(|| {
        AppError::ConfigReadError("Battle.net.config 根节点不是 JSON 对象".to_string())
    })?;

    let osic = games
        .entry("Games")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| {
            AppError::ConfigReadError("Battle.net.config Games 不是 JSON 对象".to_string())
        })?
        .entry("osic")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| {
            AppError::ConfigReadError("Battle.net.config Games.osic 不是 JSON 对象".to_string())
        })?;

    if mod_args.is_empty() {
        osic.remove("AdditionalLaunchArguments");
    } else {
        osic.insert(
            "AdditionalLaunchArguments".to_string(),
            serde_json::Value::String(mod_args.to_string()),
        );
    }

    let new_content = serde_json::to_string_pretty(&config)?;
    std::fs::write(config_path, new_content)?;
    Ok(())
}

/// 对单个账号执行注册表导入
#[tauri::command]
pub fn repair_account_registry(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> Result<(), AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let json_path =
        AccountManager::account_dir_checked(&cfg.accounts_dir, &account_id)?.join("unified_auth.json");
    if json_path.exists() {
        restore_registry_from_json(&json_path)?;
    }
    Ok(())
}

/// 导入所有已初始化账号的注册表
#[tauri::command]
pub fn repair_all_registries(state: tauri::State<'_, SharedState>) -> Result<(), AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let ids = AccountManager::list_ids(&cfg.accounts_dir);
    for id in ids {
        let json_path =
            AccountManager::account_dir_checked(&cfg.accounts_dir, &id)?.join("unified_auth.json");
        if json_path.exists() {
            restore_registry_from_json(&json_path)?;
        }
    }
    Ok(())
}

// ── 初始化快照采集 ──

/// 账号初始化完成后，采集所有快照文件
#[tauri::command]
pub async fn collect_account_snapshot(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> Result<(), AppError> {
    let state_arc = state.inner().clone();
    tokio::task::spawn_blocking(move || collect_account_snapshot_blocking(&state_arc, &account_id))
        .await
        .map_err(|e| AppError::Unknown(format!("Snapshot task panicked: {}", e)))?
}

fn collect_account_snapshot_blocking(
    state: &SharedState,
    account_id: &str,
) -> Result<(), AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let account_dir = AccountManager::account_dir_checked(&cfg.accounts_dir, account_id)?;

    // 1. 拷贝 Battle.net Roaming 文件夹
    let bnet_src = Path::new(&cfg.app_data_roaming_bnet_path);
    let bnet_dst = account_dir.join("Battle.net");
    if bnet_src.exists() {
        crate::commands::utils::copy_dir_recursive(bnet_src, &bnet_dst)?;
        // 强制确保 SingleInstance 为 true
        enforce_single_instance(&bnet_dst.join("Battle.net.config"))?;
    }

    // 2. 从全局存档配置路径复制真实 Settings.json
    if let Err(error) =
        copy_system_settings_to_account_if_available(Path::new(&cfg.saved_games_path), &account_dir)
    {
        crate::logger::log_msg(
            "WARN",
            "Account",
            &format!("初始化账号时跳过可选 Settings.json 快照: {}", error),
        );
    }

    // 3. 导出注册表
    let json_dst = account_dir.join("unified_auth.json");
    backup_registry_to_json(&json_dst)?;

    // 4. 更新账号初始化状态，同步/注入 Mod 参数
    let mut meta = AccountManager::load_meta(&cfg.accounts_dir, account_id)?;
    meta.initialized = true;
    meta.last_reset_at = Some(chrono::Utc::now().to_rfc3339());

    if bnet_dst.exists() {
        let bnet_config = bnet_dst.join("Battle.net.config");
        if bnet_config.exists() {
            if meta.mod_args.is_empty() {
                if let Some(args) = read_mod_args_from_config(&bnet_config) {
                    meta.mod_args = args;
                }
            } else {
                let _ = inject_mod_args(&bnet_config, &meta.mod_args);
            }
        }
    }

    AccountManager::save_meta(&cfg.accounts_dir, &meta)?;

    // 5. 快照采集完成后自动清理：杀战网 + 清空注册表
    cleanup_after_snapshot()?;

    // 6. 关闭刚才打开的浏览器的所有进程（因为启动前已清理，此时只剩我们打开的）
    if cfg.auto_close_browser {
        kill_browser_processes_blocking(&cfg.browser_type);
    }

    Ok(())
}

/// 初始化/重新初始化完成后：杀战网、清空 UnifiedAuth 注册表
fn cleanup_after_snapshot() -> Result<(), AppError> {
    // 杀战网与 Agent
    kill_processes_by_name(&["Battle.net.exe", "Agent.exe"]);
    // 清空注册表
    clear_auth_registry()
}

#[cfg(test)]
mod settings_json_tests {
    use super::{copy_account_settings_to_system, copy_system_settings_to_account_if_available};
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let unique = format!(
            "d2rhub_{name}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_system_settings_is_optional_for_account_creation() {
        let saved_games = temp_dir("missing_system_settings");
        let account_dir = temp_dir("account_without_settings");

        let copied =
            copy_system_settings_to_account_if_available(&saved_games, &account_dir).unwrap();

        assert!(!copied);
        assert!(!account_dir.join("Settings.json").exists());
        let _ = std::fs::remove_dir_all(saved_games);
        let _ = std::fs::remove_dir_all(account_dir);
    }

    #[test]
    fn existing_system_settings_is_copied_to_account() {
        let saved_games = temp_dir("existing_system_settings");
        let account_dir = temp_dir("account_with_settings");
        std::fs::write(saved_games.join("Settings.json"), r#"{"VSync":1}"#).unwrap();

        let copied =
            copy_system_settings_to_account_if_available(&saved_games, &account_dir).unwrap();

        assert!(copied);
        assert_eq!(
            std::fs::read_to_string(account_dir.join("Settings.json")).unwrap(),
            r#"{"VSync":1}"#
        );
        let _ = std::fs::remove_dir_all(saved_games);
        let _ = std::fs::remove_dir_all(account_dir);
    }

    #[test]
    fn customized_settings_requires_an_account_settings_file() {
        let saved_games = temp_dir("customized_settings_target");
        let account_dir = temp_dir("customized_settings_source");

        let error = copy_account_settings_to_system(&account_dir, &saved_games).unwrap_err();

        assert!(error.to_string().contains("账号 Settings.json 不存在"));
        let _ = std::fs::remove_dir_all(saved_games);
        let _ = std::fs::remove_dir_all(account_dir);
    }
}

/// 清空 UnifiedAuth 注册表键值（保留键本身）
#[tauri::command]
pub fn clear_auth_registry() -> Result<(), AppError> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey_with_flags(
        r"Software\Blizzard Entertainment\Battle.net\UnifiedAuth",
        KEY_WRITE | KEY_READ,
    ) {
        let mut names = Vec::new();
        for val_res in key.enum_values() {
            if let Ok((name, _)) = val_res {
                names.push(name);
            }
        }
        for name in names {
            let _ = key.delete_value(&name);
        }
    }
    Ok(())
}

/// 将账号存储的配置恢复到系统目录（用于重新初始化）
fn restore_account_to_system(
    account_dir: &Path,
    cfg: &crate::commands::global_config::GlobalConfig,
) -> Result<(), AppError> {
    // 1. 复制 Battle.net Roaming 配置到系统
    let bnet_src = account_dir.join("Battle.net");
    let bnet_dst = Path::new(&cfg.app_data_roaming_bnet_path);
    if bnet_src.exists() {
        if bnet_dst.exists() {
            let _ = std::fs::remove_dir_all(bnet_dst);
        }
        crate::commands::utils::copy_dir_recursive(&bnet_src, bnet_dst)?;
        enforce_single_instance(&bnet_dst.join("Battle.net.config"))?;
    }
    // 2. 注意：不恢复 Settings.json —— 重新初始化不改变游戏设置
    // 3. 注意：不导入旧注册表 —— 重新初始化需要用户重新登录，
    // 旧认证数据会导致战网自动登录旧账号，而非弹出登录界面。

    Ok(())
}

/// 重新初始化账号：恢复配置 → 启动战网 → 等登录 → 重新采集快照 → 自动清理
#[tauri::command]
pub async fn reinitialize_account(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> Result<(), AppError> {
    let state_arc = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        reinitialize_account_blocking(&app, &state_arc, &account_id)
    })
    .await
    .map_err(|e| AppError::Unknown(format!("Reinit task panicked: {}", e)))?
}

fn reinitialize_account_blocking(
    app: &tauri::AppHandle,
    state: &SharedState,
    account_id: &str,
) -> Result<(), AppError> {
    let res = reinitialize_account_blocking_inner(app, state, account_id);

    // 整个重置流程成功或失败后，均进行一次无差别杀浏览器进程的操作
    if let Some(ref cfg) = *state.config.read() {
        if cfg.auto_close_browser {
            kill_browser_processes_blocking(&cfg.browser_type);
        }
    }

    res
}

fn reinitialize_account_blocking_inner(
    app: &tauri::AppHandle,
    state: &SharedState,
    account_id: &str,
) -> Result<(), AppError> {
    state
        .cancel_launch
        .store(false, std::sync::atomic::Ordering::Relaxed);
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let account_dir = AccountManager::account_dir_checked(&cfg.accounts_dir, account_id)?;
    let mut meta = AccountManager::load_meta(&cfg.accounts_dir, account_id)?;

    let emit = |step: &str, status: &str, msg: &str| {
        crate::logger::log_msg(
            "INFO",
            "Reset",
            &format!("[Account {}] [{}] [{}]: {}", account_id, step, status, msg),
        );
        let _ = app.emit(
            "launch-progress",
            crate::commands::system::LaunchProgress::new(account_id, step, status, msg),
        );
    };

    // 如果是 token 模式，直接短路返回，不需要走战网重置流程
    if meta.auth_mode.as_deref() == Some("token") {
        emit(
            "clean",
            "running",
            "Token 模式无需重置战网，正在刷新初始化状态...",
        );

        meta.initialized = true;
        meta.last_reset_at = Some(chrono::Utc::now().to_rfc3339());

        AccountManager::save_meta(&cfg.accounts_dir, &meta)?;
        emit("done", "ok", "Token 账号初始化/重置成功！");
        return Ok(());
    }

    // 1. 清理环境
    emit("clean", "running", "正在清理战网和 Agent 进程...");
    kill_processes_by_name(&["Battle.net.exe", "Agent.exe"]);
    std::thread::sleep(std::time::Duration::from_millis(500));
    emit("clean", "ok", "环境清理完成");

    // 1.5 启动浏览器（使用账号对应的用户配置）
    if !cfg.browser_path.is_empty() && !cfg.browser_type.is_empty() {
        emit("browser", "running", "正在启动独立浏览器以引导登录...");
        #[cfg(target_os = "windows")]
        let before_hwnds = crate::commands::system::collect_chrome_windows();

        let _ = crate::commands::browser::launch_browser_for_account_impl(
            &cfg,
            &cfg.browser_path,
            account_id,
        );

        #[cfg(target_os = "windows")]
        crate::commands::system::bring_browser_login_to_foreground(before_hwnds);

        std::thread::sleep(std::time::Duration::from_millis(1500));
        emit("browser", "ok", "浏览器已启动，准备开始引导登录");
    }

    // 2. 恢复账号配置到系统（不含注册表，旧认证数据不导入）
    emit("restore", "running", "正在将本地账号配置还原到系统...");
    restore_account_to_system(&account_dir, &cfg)?;
    emit("restore", "ok", "配置还原完成");

    // 3. 清除 UnifiedAuth 注册表，确保战网弹出登录界面而非自动登录旧账号
    emit("registry", "running", "正在清理系统注册表认证数据...");
    clear_auth_registry()?;
    emit("registry", "ok", "注册表清理完成");

    // 4. 启动战网
    emit(
        "launch",
        "running",
        "正在启动战网客户端，请在弹出的战网中登录账号...",
    );
    std::process::Command::new(&cfg.battle_net_path)
        .spawn()
        .map_err(|e| AppError::FileError(format!("启动战网失败: {}", e)))?;

    // 确保战网置顶
    crate::commands::system::bring_bnet_to_foreground();

    // 5. 轮询进程数检测登录（>=7 = 登录完成，支持最长 2 分钟，支持用户主动取消）
    let mut logged_in = false;
    for i in 1..=120 {
        std::thread::sleep(std::time::Duration::from_secs(1));

        // 允许主动取消退出流程
        if state
            .cancel_launch
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            emit("launch", "error", "重置已被主动取消");
            let _ = cleanup_after_snapshot();
            if cfg.auto_close_browser {
                kill_browser_processes_blocking(&cfg.browser_type);
            }
            return Err(AppError::Unknown("重置已被取消".to_string()));
        }

        if crate::commands::system::check_bnet_logged_in() {
            logged_in = true;
            break;
        }
        if i % 5 == 0 {
            emit(
                "launch",
                "running",
                &format!("等待战网登录中... (已等待 {}s)", i),
            );
        }
    }
    if !logged_in {
        emit("launch", "error", "等待登录超时（120秒）");
        if cfg.auto_close_browser {
            kill_browser_processes_blocking(&cfg.browser_type);
        }
        return Err(AppError::LoginTimeout(120));
    }
    emit("launch", "ok", "检测到登录成功！开始采集认证凭据...");

    // 6. 重新采集快照（会自动清理）
    emit("snapshot", "running", "正在采集并保存新账号快照...");
    collect_account_snapshot_inner(&cfg, account_id)?;
    emit("snapshot", "ok", "快照采集并保存完成！");

    // 关闭刚才打开的浏览器的所有进程
    if cfg.auto_close_browser {
        kill_browser_processes_blocking(&cfg.browser_type);
        emit("done", "ok", "重置已全部完成，浏览器已自动关闭");
    } else {
        emit("done", "ok", "重置已全部完成");
    }

    Ok(())
}

/// 内部快照采集（不加 tauri::command，供 reinitialize 复用）
fn collect_account_snapshot_inner(
    cfg: &crate::commands::global_config::GlobalConfig,
    account_id: &str,
) -> Result<(), AppError> {
    let account_dir = AccountManager::account_dir_checked(&cfg.accounts_dir, account_id)?;

    // 拷贝 Battle.net Roaming
    let bnet_src = Path::new(&cfg.app_data_roaming_bnet_path);
    let bnet_dst = account_dir.join("Battle.net");
    if bnet_src.exists() {
        crate::commands::utils::copy_dir_recursive(bnet_src, &bnet_dst)?;
        enforce_single_instance(&bnet_dst.join("Battle.net.config"))?;
    }

    // 注意：不采集 Settings.json —— 重新初始化不改变游戏设置

    // 导出注册表（失败则整体回滚，不将账号标记为已初始化）
    let json_dst = account_dir.join("unified_auth.json");
    backup_registry_to_json(&json_dst)
        .map_err(|e| AppError::RegistryError(format!("导出注册表快照失败: {}", e)))?;

    // 更新初始化状态，同步/注入 Mod 参数 到 Battle.net.config
    // （防止战网在登录过程中重置了 AdditionalLaunchArguments）
    let mut meta = AccountManager::load_meta(&cfg.accounts_dir, account_id)?;
    meta.initialized = true;
    meta.last_reset_at = Some(chrono::Utc::now().to_rfc3339());

    let bnet_config = bnet_dst.join("Battle.net.config");
    if bnet_config.exists() {
        if meta.mod_args.is_empty() {
            if let Some(args) = read_mod_args_from_config(&bnet_config) {
                meta.mod_args = args;
            }
        } else {
            let _ = inject_mod_args(&bnet_config, &meta.mod_args);
        }
    }
    AccountManager::save_meta(&cfg.accounts_dir, &meta)?;

    // 自动清理
    cleanup_after_snapshot()?;

    Ok(())
}

/// 将系统当前状态回写到账号备份（战网优雅退出后调用）
/// - 导出 UnifiedAuth 注册表 → account/unified_auth.json
/// - 复制 Battle.net Roaming 文件夹 → account/Battle.net/
/// - 强制确保 SingleInstance = "true"
/// 写入过程原子化：先写临时文件/目录，校验通过后再 rename 替换旧数据
pub fn sync_back_to_account(
    account_dir: &std::path::Path,
    cfg: &crate::commands::global_config::GlobalConfig,
) -> Result<(), AppError> {
    // 1. 导出注册表到临时文件，校验非空后再原子替换
    let json_tmp = account_dir.join("unified_auth.json.tmp");
    let json_dst = account_dir.join("unified_auth.json");
    backup_registry_to_json(&json_tmp)?;

    {
        let content = std::fs::read_to_string(&json_tmp)?;
        let backups: Vec<RegistryValueBackup> = serde_json::from_str(&content)
            .map_err(|e| AppError::FileError(format!("unified_auth.json 反序列化失败: {}", e)))?;
        if backups.is_empty() {
            let _ = std::fs::remove_file(&json_tmp);
            return Err(AppError::RegistryError(
                "导出注册表为空——战网可能未登录或认证数据已丢失".to_string(),
            ));
        }
    }

    // 校验通过，原子替换
    std::fs::rename(&json_tmp, &json_dst)?;

    // 2. 回写 Battle.net Roaming 文件夹：先拷到临时目录，再原子替换
    let bnet_src = std::path::Path::new(&cfg.app_data_roaming_bnet_path);
    let bnet_dst = account_dir.join("Battle.net");
    if bnet_src.exists() {
        let bnet_tmp = account_dir.join("Battle.net.tmp");
        // 清理可能残留的临时目录（上次异常中断）
        if bnet_tmp.exists() {
            let _ = std::fs::remove_dir_all(&bnet_tmp);
        }
        crate::commands::utils::copy_dir_recursive(bnet_src, &bnet_tmp)?;
        enforce_single_instance(&bnet_tmp.join("Battle.net.config"))?;

        // copy 成功后才替换旧目录
        if bnet_dst.exists() {
            let _ = std::fs::remove_dir_all(&bnet_dst);
        }
        std::fs::rename(&bnet_tmp, &bnet_dst)?;
    }

    Ok(())
}

/// 检查 token 是否已过期（720小时/30天有效期）
/// 返回 true 表示已过期，需要重新初始化
pub fn is_token_expired(last_reset_at: &Option<String>) -> bool {
    if let Some(ts) = last_reset_at {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
            let elapsed = chrono::Utc::now().signed_duration_since(dt);
            return elapsed.num_hours() > 720;
        }
    }
    false
}

/// 强制确保 Battle.net.config 中 SingleInstance 为 "true"
pub fn enforce_single_instance(config_path: &Path) -> Result<(), AppError> {
    if !config_path.exists() {
        return Ok(());
    }
    let content = std::fs::read_to_string(config_path)?;
    let mut config: serde_json::Value = serde_json::from_str(&content)?;

    if let Some(client) = config.get_mut("Client") {
        if let Some(obj) = client.as_object_mut() {
            let current = obj
                .get("SingleInstance")
                .and_then(|v| v.as_str())
                .unwrap_or("true");
            if current != "true" {
                obj.insert(
                    "SingleInstance".to_string(),
                    serde_json::Value::String("true".to_string()),
                );
                let new_content = serde_json::to_string_pretty(&config)?;
                std::fs::write(config_path, new_content)?;
            }
        }
    }
    Ok(())
}

fn kill_browser_processes_blocking(_browser_type: &str) {
    close_browser_for_profile("");
}

#[cfg(target_os = "windows")]
fn is_browser_process(pid: u32) -> bool {
    use sysinfo::System;
    let mut sys = System::new();
    let sys_pid = sysinfo::Pid::from(pid as usize);
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[sys_pid]));
    if let Some(proc) = sys.process(sys_pid) {
        let name = proc.name().to_string_lossy().to_lowercase();
        return name.contains("chrome") || name.contains("msedge");
    }
    false
}

/// 强制杀掉指定浏览器 Profile 的进程，以自动关闭在初始化/重置中打开的配置浏览器
#[cfg(target_os = "windows")]
fn close_browser_for_profile(_profile_name: &str) {
    // 方案 B：使用原生 Win32 EnumWindows + WM_CLOSE 替代不稳定的 PowerShell 发送按键
    extern "system" {
        fn EnumWindows(
            lpEnumFunc: unsafe extern "system" fn(hwnd: isize, lparam: isize) -> i32,
            lparam: isize,
        ) -> i32;
        fn GetWindowTextW(hWnd: isize, lpString: *mut u16, nMaxCount: i32) -> i32;
        fn GetClassNameW(hWnd: isize, lpClassName: *mut u16, nMaxCount: i32) -> i32;
        fn GetWindowThreadProcessId(hWnd: isize, lpdwProcessId: *mut u32) -> u32;
        fn PostMessageW(hWnd: isize, Msg: u32, wParam: usize, lParam: isize) -> i32;
    }

    const WM_CLOSE: u32 = 0x0010;

    unsafe extern "system" fn close_bnet_window_callback(hwnd: isize, _lparam: isize) -> i32 {
        let mut title = [0u16; 512];
        let len = GetWindowTextW(hwnd, title.as_mut_ptr(), 512);
        if len > 0 {
            let title_str = String::from_utf16_lossy(&title[..len as usize]).to_lowercase();
            if title_str.contains("battle.net")
                || title_str.contains("blizzard")
                || title_str.contains("战网")
                || title_str.contains("暴雪")
            {
                let mut class_name = [0u16; 256];
                let class_len = GetClassNameW(hwnd, class_name.as_mut_ptr(), 256);
                if class_len > 0 {
                    let class_str = String::from_utf16_lossy(&class_name[..class_len as usize]);
                    if class_str == "Chrome_WidgetWin_1" {
                        let mut pid = 0u32;
                        GetWindowThreadProcessId(hwnd, &mut pid);
                        if pid != 0 && is_browser_process(pid) {
                            // 发送 WM_CLOSE 消息给浏览器窗口
                            let _ = PostMessageW(hwnd, WM_CLOSE, 0, 0);
                        }
                    }
                }
            }
        }
        1 // 继续枚举
    }

    unsafe {
        EnumWindows(close_bnet_window_callback, 0);
    }
}

#[cfg(not(target_os = "windows"))]
fn close_browser_for_profile(_profile_name: &str) {}

#[tauri::command]
pub fn move_game_window(
    state: tauri::State<'_, SharedState>,
    account_id: String,
) -> Result<(), AppError> {
    let config = state.config.read();
    let cfg = config
        .as_ref()
        .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?;

    let meta = AccountManager::load_meta(&cfg.accounts_dir, &account_id)?;
    if meta.window_x.is_none() && meta.window_y.is_none() {
        return Ok(());
    }

    let x = meta.window_x.unwrap_or(0);
    let y = meta.window_y.unwrap_or(0);

    let pid = {
        let active = state.active_games.read();
        active.get(&account_id).copied()
    };

    if let Some(pid) = pid {
        crate::commands::system::set_game_window_position(pid, x, y);
    } else {
        let display = if meta.display_name.is_empty() {
            &meta.id
        } else {
            &meta.display_name
        };
        crate::commands::system::set_game_window_position_by_title(display, x, y);
    }
    Ok(())
}
