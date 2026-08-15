use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::commands::account::{AccountManager, AccountMeta};
use crate::error::AppError;
use crate::state::SharedState;

/// 全局配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalConfig {
    pub version: u32,
    pub battle_net_path: String,
    pub game_path: String,
    pub saved_games_path: String,
    pub program_data_agent_path: String,
    pub app_data_roaming_bnet_path: String,
    pub accounts_dir: String,
    pub first_run_complete: bool,
    /// 浏览器可执行文件路径（Edge 或 Chrome）
    #[serde(default)]
    pub browser_path: String,
    /// 浏览器类型: "edge" | "chrome" | "" (未配置)
    #[serde(default)]
    pub browser_type: String,
    #[serde(default = "default_enable_bongo_cat")]
    pub enable_bongo_cat: bool,
    #[serde(default = "default_bongo_cat_chatterbox")]
    pub bongo_cat_chatterbox: bool,
    #[serde(default = "default_bongo_cat_scale")]
    pub bongo_cat_scale: f32,
    #[serde(default = "default_bongo_cat_skin")]
    pub bongo_cat_skin: String,
    #[serde(default = "default_bongo_cat_unlocked_skins")]
    pub bongo_cat_unlocked_skins: Vec<String>,
    /// 最小化时是否显示悬浮窗
    #[serde(default = "default_enable_overlay")]
    pub enable_overlay: bool,
    /// 主题选择: "onyx" | "light"
    #[serde(default = "default_theme")]
    pub theme: String,
    /// 悬浮窗主题选择: "onyx" | "light"
    #[serde(default = "default_theme")]
    pub theme_overlay: String,
    /// 是否在登录后/流程结束后自动关闭浏览器，以及在启动前做清理
    #[serde(default = "default_auto_close_browser")]
    pub auto_close_browser: bool,
    /// 是否在每天启动时自动检查更新
    #[serde(default = "default_enable_auto_update")]
    pub enable_auto_update: bool,
    /// 是否首次启动（自动弹出帮助文档）
    #[serde(default = "default_first_launch")]
    pub first_launch: bool,
    /// OCR：是否启用自动文字识别
    #[serde(default)]
    pub ocr_enabled: bool,
    /// OCR：被监控的账号 ID（对应 account.json 中的 id）
    #[serde(default)]
    pub ocr_target_account: String,
    pub ocr_ch_b_profiles_json: String,
    /// OCR：是否开启调试输出（保存截图到 config/test）
    #[serde(default)]
    pub ocr_debug_output: bool,

    /// OCR：轮询间隔 (ms)，默认 500 (2Hz)，性能不足可设为 1000 (1Hz)
    #[serde(default = "default_ocr_poll_interval")]
    pub ocr_poll_interval_ms: u64,
    /// 快捷键绑定 JSON: {"1": "Ctrl+1", "2": "Ctrl+2", ...} ，key 为账号位置序号（1-based）
    /// 空字符串表示从未配置过（首次启动时自动迁移为默认值）
    #[serde(default)]
    pub shortcut_bindings_json: String,
    /// 悬浮窗透明度 (10-100, 默认 95)
    #[serde(default = "default_opacity")]
    pub overlay_opacity: u8,
    /// 主界面透明度 (10-100, 默认 95)
    #[serde(default = "default_opacity")]
    pub main_opacity: u8,
    /// 界面字体缩放 ("small" / "default" / "large")
    #[serde(default = "default_font_scale")]
    pub font_scale: String,
    /// 应用界面语言 ("zh-CN" / "en-US")
    #[serde(default = "default_app_language")]
    pub app_language: String,
    /// Agent 多开模式: 1=延时杀, 2=进程数阈值杀
    #[serde(default = "default_agent_mode")]
    pub agent_mode: u8,
    /// 模式1: Agent 存活延迟 (秒), 0-30, 默认 1.0
    #[serde(default = "default_agent_delay_secs")]
    pub agent_delay_secs: f64,
    /// 模式2: bnet_count 阈值, 4/5/7, 默认 5
    #[serde(default = "default_agent_threshold")]
    pub agent_threshold: u32,
    /// OCR 计时模式: "full_clear" | "single_scene" | "start_middle_end"
    #[serde(default = "default_ocr_timing_mode")]
    pub ocr_timing_mode: String,
    /// OCR 阶段标记配置 JSON: {"start":[],"middle":[],"end":[]}
    #[serde(default = "default_ocr_phase_config_json")]
    pub ocr_phase_config_json: String,
    /// OCR 切屏自动暂停
    #[serde(default)]
    pub ocr_auto_pause_on_switch: bool,
}

fn default_font_scale() -> String { "default".to_string() }
fn default_app_language() -> String { "zh-CN".to_string() }
fn default_opacity() -> u8 { 95 }

fn default_ocr_poll_interval() -> u64 { 500 }

fn default_agent_mode() -> u8 { 1 }
fn default_agent_delay_secs() -> f64 { 1.0 }
fn default_agent_threshold() -> u32 { 5 }

fn default_ocr_timing_mode() -> String { "full_clear".to_string() }
fn default_ocr_phase_config_json() -> String { "{}".to_string() }

fn default_theme() -> String {
    "light".to_string()
}



fn default_enable_overlay() -> bool {
    true
}

fn default_auto_close_browser() -> bool {
    true
}

fn default_enable_auto_update() -> bool {
    true
}

fn default_first_launch() -> bool {
    true
}
fn default_enable_bongo_cat() -> bool { true }
fn default_bongo_cat_chatterbox() -> bool { true }
fn default_bongo_cat_scale() -> f32 { 1.0 }
fn default_bongo_cat_skin() -> String { "original".to_string() }
fn default_bongo_cat_unlocked_skins() -> Vec<String> { vec!["original".to_string()] }

fn app_accounts_dir(app_data_dir: &str) -> PathBuf {
    Path::new(app_data_dir).join("accounts")
}

fn file_name_eq(path: &Path, expected: &str) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

fn saved_games_settings_exists(path: &Path) -> bool {
    path.join("Settings.json").is_file()
}

fn validate_config_paths(config: &GlobalConfig) -> Result<(), AppError> {
    let battle_net_path = Path::new(&config.battle_net_path);
    if !battle_net_path.is_file() || !file_name_eq(battle_net_path, "Battle.net.exe") {
        return Err(AppError::InvalidBnetPath(config.battle_net_path.clone()));
    }

    let game_path = Path::new(&config.game_path);
    if !game_path.is_dir() {
        return Err(AppError::InvalidGamePath(config.game_path.clone()));
    }

    if !config.browser_path.trim().is_empty() {
        let browser_path = Path::new(&config.browser_path);
        if !browser_path.is_file() {
            return Err(AppError::ConfigWriteError(format!(
                "浏览器路径无效: {}",
                config.browser_path
            )));
        }

        match config.browser_type.as_str() {
            "chrome" if !file_name_eq(browser_path, "chrome.exe") => {
                return Err(AppError::ConfigWriteError(format!(
                    "浏览器类型为 chrome，但路径不是 chrome.exe: {}",
                    config.browser_path
                )));
            }
            "edge" if !file_name_eq(browser_path, "msedge.exe") => {
                return Err(AppError::ConfigWriteError(format!(
                    "浏览器类型为 edge，但路径不是 msedge.exe: {}",
                    config.browser_path
                )));
            }
            _ => {}
        }
    }

    Ok(())
}

#[cfg(test)]
mod validation_tests {
    use super::{saved_games_settings_exists, validate_config_paths, GlobalConfig};
    use crate::commands::account::{AccountManager, AccountMeta};

    fn temp_dir(name: &str) -> std::path::PathBuf {
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
    fn invalid_saved_games_path_does_not_block_core_configuration() {
        let root = temp_dir("config_without_saved_games");
        let battle_net = root.join("Battle.net.exe");
        let game_dir = root.join("game");
        std::fs::write(&battle_net, b"").unwrap();
        std::fs::create_dir_all(&game_dir).unwrap();

        let mut config = GlobalConfig::default();
        config.battle_net_path = battle_net.to_string_lossy().to_string();
        config.game_path = game_dir.to_string_lossy().to_string();
        config.saved_games_path = root.join("missing").to_string_lossy().to_string();

        assert!(validate_config_paths(&config).is_ok());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn settings_availability_requires_the_actual_file() {
        let saved_games = temp_dir("settings_availability");
        assert!(!saved_games_settings_exists(&saved_games));

        std::fs::write(saved_games.join("Settings.json"), b"{}").unwrap();

        assert!(saved_games_settings_exists(&saved_games));
        let _ = std::fs::remove_dir_all(saved_games);
    }

    #[test]
    fn enabled_ocr_requires_a_selected_account() {
        let mut config = GlobalConfig::default();
        config.ocr_enabled = true;

        assert!(config.resolve_ocr_target_account().is_err());
    }

    #[test]
    fn disabled_ocr_does_not_require_a_target_account() {
        let config = GlobalConfig::default();

        assert!(config.resolve_ocr_target_account().unwrap().is_none());
    }

    #[test]
    fn enabled_ocr_requires_an_initialized_account() {
        let accounts_dir = temp_dir("ocr_uninitialized_account");
        let account = AccountMeta::new("acount1");
        AccountManager::save_meta(accounts_dir.to_str().unwrap(), &account).unwrap();

        let mut config = GlobalConfig::default();
        config.accounts_dir = accounts_dir.to_string_lossy().to_string();
        config.ocr_enabled = true;
        config.ocr_target_account = account.id;

        assert!(config.resolve_ocr_target_account().is_err());
        let _ = std::fs::remove_dir_all(accounts_dir);
    }

    #[test]
    fn enabled_ocr_accepts_an_initialized_account() {
        let accounts_dir = temp_dir("ocr_initialized_account");
        let mut account = AccountMeta::new("acount1");
        account.initialized = true;
        AccountManager::save_meta(accounts_dir.to_str().unwrap(), &account).unwrap();

        let mut config = GlobalConfig::default();
        config.accounts_dir = accounts_dir.to_string_lossy().to_string();
        config.ocr_enabled = true;
        config.ocr_target_account = account.id.clone();

        let resolved = config.resolve_ocr_target_account().unwrap().unwrap();
        assert_eq!(resolved.id, account.id);
        let _ = std::fs::remove_dir_all(accounts_dir);
    }

    #[test]
    fn invalid_legacy_ocr_configuration_is_disabled() {
        let mut config = GlobalConfig::default();
        config.ocr_enabled = true;

        assert!(config.normalize_ocr_configuration());
        assert!(!config.ocr_enabled);
    }
}

/// 窗口几何信息（位置+尺寸持久化）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self {
            version: 1,
            battle_net_path: String::new(),
            game_path: String::new(),
            saved_games_path: String::new(),
            program_data_agent_path: String::new(),
            app_data_roaming_bnet_path: String::new(),
            accounts_dir: String::new(),
            first_run_complete: false,
            browser_path: String::new(),
            browser_type: String::new(),
            enable_bongo_cat: true,
            bongo_cat_chatterbox: true,
            bongo_cat_scale: 1.0,
            bongo_cat_skin: "original".to_string(),
            bongo_cat_unlocked_skins: vec!["original".to_string()],
            enable_overlay: true,
            theme: "light".to_string(),
            theme_overlay: "light".to_string(),
            auto_close_browser: true,
            enable_auto_update: true,
            first_launch: true,
            ocr_enabled: false,
            ocr_target_account: String::new(),
            ocr_ch_b_profiles_json: String::new(),
            ocr_debug_output: false,

            ocr_poll_interval_ms: 500,
            shortcut_bindings_json: r#"{"1":"Ctrl+1","2":"Ctrl+2","3":"Ctrl+3"}"#.to_string(),
            overlay_opacity: 95,
            main_opacity: 95,
            font_scale: "default".to_string(),
            app_language: "zh-CN".to_string(),
            agent_mode: 1,
            agent_delay_secs: 1.0,
            agent_threshold: 5,
            ocr_timing_mode: "full_clear".to_string(),
            ocr_phase_config_json: "{}".to_string(),
            ocr_auto_pause_on_switch: false,
        }
    }
}

impl GlobalConfig {
    /// 解析并验证当前 OCR 目标。OCR 关闭时不要求配置目标账号。
    pub(crate) fn resolve_ocr_target_account(&self) -> Result<Option<AccountMeta>, AppError> {
        if !self.ocr_enabled {
            return Ok(None);
        }

        let account_id = self.ocr_target_account.trim();
        if account_id.is_empty() {
            return Err(AppError::ConfigWriteError(
                "启用 OCR 前请先选择目标账号".to_string(),
            ));
        }

        let account = AccountManager::load_meta(&self.accounts_dir, account_id).map_err(|_| {
            AppError::ConfigWriteError(format!("OCR 目标账号不存在: {account_id}"))
        })?;
        if !account.initialized {
            return Err(AppError::ConfigWriteError(format!(
                "OCR 目标账号尚未初始化: {account_id}"
            )));
        }

        Ok(Some(account))
    }

    /// 兼容旧配置：无效目标不能保持 OCR 启用状态。
    fn normalize_ocr_configuration(&mut self) -> bool {
        if !self.ocr_enabled || self.resolve_ocr_target_account().is_ok() {
            return false;
        }

        self.ocr_enabled = false;
        true
    }

    fn config_path(app_data_dir: &str) -> PathBuf {
        Path::new(app_data_dir).join("global_config.json")
    }

    fn geometry_path(app_data_dir: &str) -> PathBuf {
        Path::new(app_data_dir).join("window_geometry.json")
    }

    /// 从磁盘加载配置
    pub fn load(app_data_dir: &str) -> Result<Self, AppError> {
        let path = Self::config_path(app_data_dir);
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(&path)
            .map_err(|e| AppError::ConfigReadError(e.to_string()))?;
        let mut config: GlobalConfig = serde_json::from_str(&content)?;
        let mut migrated = false;

        let accounts_dir = app_accounts_dir(app_data_dir).to_string_lossy().to_string();
        if config.accounts_dir != accounts_dir {
            config.accounts_dir = accounts_dir;
            migrated = true;
        }

        // 迁移：从未配置过快捷键的旧用户，自动写入默认值
        if config.shortcut_bindings_json.is_empty() {
            config.shortcut_bindings_json =
                r#"{"1":"Ctrl+1","2":"Ctrl+2","3":"Ctrl+3"}"#.to_string();
            migrated = true;
        }
        // 迁移：去除旧版本可能存在的 Win/Meta/Cmd 修饰键（v0.6.6 起不再支持）
        migrated |= Self::strip_win_modifiers(&mut config.shortcut_bindings_json);

        if config.normalize_ocr_configuration() {
            log::warn!("检测到无效的旧版 OCR 目标配置，已自动关闭 OCR");
            migrated = true;
        }

        if migrated {
            let _ = config.save(app_data_dir);
        }
        Ok(config)
    }

    /// 保存配置到磁盘
    pub fn save(&self, app_data_dir: &str) -> Result<(), AppError> {
        let dir = Path::new(app_data_dir);
        if !dir.exists() {
            std::fs::create_dir_all(dir)
                .map_err(|e| AppError::ConfigWriteError(e.to_string()))?;
        }
        let path = Self::config_path(app_data_dir);
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, content)
            .map_err(|e| AppError::ConfigWriteError(e.to_string()))?;
        Ok(())
    }

    /// 规范化所有快捷键绑定：去除 Win/Meta/Cmd 修饰键，统一首字母大写格式
    /// 返回 true 表示发生了修改，调用方应持久化
    fn strip_win_modifiers(json: &mut String) -> bool {
        let bindings: std::collections::HashMap<String, String> =
            match serde_json::from_str(json) {
                Ok(b) => b,
                Err(_) => return false,
            };
        let mut changed = false;
        let cleaned: std::collections::HashMap<String, String> = bindings
            .into_iter()
            .filter_map(|(pos, combo)| {
                let lower = combo.to_lowercase();
                // 剥离 Win/Meta/Cmd 修饰键
                let stripped_parts: Vec<&str> = lower
                    .split('+')
                    .filter(|p| !matches!(*p, "win" | "meta" | "cmd" | "command"))
                    .collect();
                if stripped_parts.is_empty() {
                    log::warn!("快捷键位置 {} 的原绑定 \"{}\" 仅包含 Win 修饰键，已自动清除", pos, combo);
                    changed = true;
                    return None;
                }
                let had_win = stripped_parts.len() < lower.split('+').count();
                // 对所有部分进行规范化（统一首字母大写格式）
                let normalized = stripped_parts
                    .iter()
                    .map(|p| Self::capitalize_key_part(p))
                    .collect::<Vec<_>>()
                    .join("+");
                if normalized != combo {
                    if had_win {
                        log::warn!("快捷键位置 {} 的原绑定 \"{}\" 包含 Win/Meta/Cmd，已自动迁移为 \"{}\"", pos, combo, normalized);
                    } else {
                        log::warn!("快捷键位置 {} 的原绑定 \"{}\" 格式不规范，已自动规范化为 \"{}\"", pos, combo, normalized);
                    }
                    changed = true;
                    Some((pos, normalized))
                } else {
                    Some((pos, combo))
                }
            })
            .collect();
        if changed {
            *json = serde_json::to_string(&cleaned).unwrap_or_else(|_| "{}".to_string());
        }
        changed
    }

    /// 将小写键名转为标准格式：Ctrl, Alt, Shift, F1-F24, A-Z, 0-9, Space, Enter 等
    fn capitalize_key_part(p: &str) -> String {
        match p {
            "ctrl" => "Ctrl".to_string(),
            "alt" => "Alt".to_string(),
            "shift" => "Shift".to_string(),
            "space" => "Space".to_string(),
            "enter" => "Enter".to_string(),
            "tab" => "Tab".to_string(),
            "escape" => "Escape".to_string(),
            "backspace" => "Backspace".to_string(),
            "delete" => "Delete".to_string(),
            "insert" => "Insert".to_string(),
            "home" => "Home".to_string(),
            "end" => "End".to_string(),
            "pageup" => "PageUp".to_string(),
            "pagedown" => "PageDown".to_string(),
            "up" => "Up".to_string(),
            "down" => "Down".to_string(),
            "left" => "Left".to_string(),
            "right" => "Right".to_string(),
            _ if p.len() == 1 => p.to_uppercase(),
            _ => p.to_string(),
        }
    }

    /// 保存窗口几何
    pub fn save_geometry(app_data_dir: &str, geo: &WindowGeometry) -> Result<(), AppError> {
        let dir = Path::new(app_data_dir);
        if !dir.exists() {
            std::fs::create_dir_all(dir).map_err(|e| AppError::ConfigWriteError(e.to_string()))?;
        }
        let path = Self::geometry_path(app_data_dir);
        let content = serde_json::to_string_pretty(geo)?;
        std::fs::write(&path, content).map_err(|e| AppError::ConfigWriteError(e.to_string()))?;
        Ok(())
    }

    /// 加载窗口几何
    pub fn load_geometry(app_data_dir: &str) -> Option<WindowGeometry> {
        let path = Self::geometry_path(app_data_dir);
        if !path.exists() {
            return None;
        }
        let content = std::fs::read_to_string(&path).ok()?;
        serde_json::from_str::<WindowGeometry>(&content).ok()
    }

    fn overlay_geometry_path(app_data_dir: &str) -> PathBuf {
        Path::new(app_data_dir).join("overlay_geometry.json")
    }

    /// 保存悬浮窗几何
    pub fn save_overlay_geometry_fn(app_data_dir: &str, geo: &WindowGeometry) -> Result<(), AppError> {
        let dir = Path::new(app_data_dir);
        if !dir.exists() {
            std::fs::create_dir_all(dir).map_err(|e| AppError::ConfigWriteError(e.to_string()))?;
        }
        let path = Self::overlay_geometry_path(app_data_dir);
        let content = serde_json::to_string_pretty(geo)?;
        std::fs::write(&path, content).map_err(|e| AppError::ConfigWriteError(e.to_string()))?;
        Ok(())
    }

    /// 加载悬浮窗几何
    pub fn load_overlay_geometry_fn(app_data_dir: &str) -> Option<WindowGeometry> {
        let path = Self::overlay_geometry_path(app_data_dir);
        if !path.exists() {
            return None;
        }
        let content = std::fs::read_to_string(&path).ok()?;
        serde_json::from_str::<WindowGeometry>(&content).ok()
    }

    /// 确保必要的目录存在
    pub fn ensure_dirs(&self) -> Result<(), AppError> {
        for dir in [&self.accounts_dir] {
            if !dir.is_empty() {
                std::fs::create_dir_all(dir)
                    .map_err(|e| AppError::ConfigWriteError(format!("无法创建目录 {}: {}", dir, e)))?;
            }
        }
        Ok(())
    }
}

pub fn update_shortcut_map(state: &SharedState, cfg: &GlobalConfig) {
    let mut map = state.shortcut_map.write();
    map.clear();
    let bindings: std::collections::HashMap<String, String> =
        serde_json::from_str(&cfg.shortcut_bindings_json).unwrap_or_default();
    for (pos_str, shortcut) in &bindings {
        if let Ok(pos) = pos_str.parse::<usize>() {
            if pos >= 1 {
                map.insert(shortcut.to_lowercase(), pos);
            }
        }
    }
}

// ── Tauri Commands ──

#[tauri::command]
pub fn get_global_config(state: tauri::State<'_, SharedState>) -> Result<GlobalConfig, AppError> {
    let config = state.config.read();
    match &*config {
        Some(c) => Ok(c.clone()),
        None => {
            // 首次调用，尝试从磁盘加载
            drop(config);
            let loaded = GlobalConfig::load(&state.app_data_dir)?;
            let mut cfg = state.config.write();
            *cfg = Some(loaded.clone());
            update_shortcut_map(&state, &loaded);
            Ok(loaded)
        }
    }
}

#[tauri::command]
pub fn save_global_config(
    state: tauri::State<'_, SharedState>,
    config: GlobalConfig,
) -> Result<(), AppError> {
    let mut cfg = config.clone();
    cfg.accounts_dir = app_accounts_dir(&state.app_data_dir)
        .to_string_lossy()
        .to_string();

    if cfg.first_run_complete {
        validate_config_paths(&cfg)?;
    }
    cfg.resolve_ocr_target_account()?;

    cfg.save(&state.app_data_dir)?;
    cfg.ensure_dirs()?;
    let mut stored = state.config.write();
    *stored = Some(cfg.clone());
    update_shortcut_map(&state, &cfg);
    crate::input_listener::set_bongo_cat_input_enabled(cfg.enable_bongo_cat);
    Ok(())
}

#[tauri::command]
pub fn check_saved_games_settings(path: String) -> bool {
    saved_games_settings_exists(Path::new(&path))
}

/// 保存窗口几何信息（位置+尺寸）
#[tauri::command]
pub fn save_window_geometry(
    state: tauri::State<'_, SharedState>,
    geometry: WindowGeometry,
) -> Result<(), AppError> {
    GlobalConfig::save_geometry(&state.app_data_dir, &geometry)
}

/// 加载窗口几何信息（返回 None 表示从未保存过）
#[tauri::command]
pub fn load_window_geometry(
    state: tauri::State<'_, SharedState>,
) -> Result<Option<WindowGeometry>, AppError> {
    Ok(GlobalConfig::load_geometry(&state.app_data_dir))
}

/// 自动探测战网客户端路径
#[tauri::command]
pub fn detect_battle_net_path() -> Option<String> {
    let candidates = [
        r"C:\Program Files (x86)\Battle.net\Battle.net.exe",
        r"C:\Program Files\Battle.net\Battle.net.exe",
        r"D:\Program Files (x86)\Battle.net\Battle.net.exe",
    ];
    for path in &candidates {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    None
}

/// 自动探测游戏存档路径（优先选择 (CN) 版本）
#[tauri::command]
pub fn detect_saved_games_path() -> Option<String> {
    if let Some(user) = dirs::home_dir() {
        let saved_games = user.join("Saved Games");
        if saved_games.exists() {
            if let Ok(entries) = std::fs::read_dir(&saved_games) {
                let matches: Vec<String> = entries
                    .flatten()
                    .filter_map(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        if name.starts_with("Diablo II Resurrected") {
                            Some(name)
                        } else {
                            None
                        }
                    })
                    .collect();
                // 优先选择 (CN) 版本
                if let Some(cn) = matches.iter().find(|n| n.contains("(CN)")) {
                    return Some(saved_games.join(cn).to_string_lossy().to_string());
                }
                if let Some(first) = matches.first() {
                    return Some(saved_games.join(first).to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

/// 检测 ProgramData 下的 Agent 路径
#[tauri::command]
pub fn detect_program_data_agent_path() -> Option<String> {
    let path = r"C:\ProgramData\Battle.net\Agent";
    if Path::new(path).exists() {
        Some(path.to_string())
    } else {
        None
    }
}

/// 供非命令函数（如 tray）获取全局配置
pub fn get_global_config_ext(app: &tauri::AppHandle) -> Option<GlobalConfig> {
    use tauri::Manager;
    if let Some(state) = app.try_state::<SharedState>() {
        let config_lock = state.config.read();
        return config_lock.clone();
    }
    None
}

/// 检测 AppData\Roaming\Battle.net 路径
#[tauri::command]
pub fn detect_app_data_roaming_bnet_path() -> Option<String> {
    if let Some(appdata) = dirs::config_dir() {
        // config_dir on Windows = %APPDATA%
        let bnet = appdata.join("Battle.net");
        if bnet.exists() {
            return Some(bnet.to_string_lossy().to_string());
        }
    }
    None
}
/// 自动探测浏览器路径（仅支持 Edge 和 Chrome）
/// 返回 (path, browser_type) 或 None
#[tauri::command]
pub fn detect_browser_path() -> Option<(String, String)> {
    // 1. 优先检测 Microsoft Edge（系统自带，路径稳定）
    let edge_candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ];
    for p in &edge_candidates {
        if std::path::Path::new(p).exists() {
            return Some((p.to_string(), "edge".to_string()));
        }
    }
    // 也尝试通过 LocalAppData 找
    if let Some(local) = dirs::data_local_dir() {
        let edge = local.join("Microsoft").join("Edge").join("Application").join("msedge.exe");
        if edge.exists() {
            return Some((edge.to_string_lossy().to_string(), "edge".to_string()));
        }
    }

    // 2. 检测 Google Chrome
    let chrome_candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    for p in &chrome_candidates {
        if std::path::Path::new(p).exists() {
            return Some((p.to_string(), "chrome".to_string()));
        }
    }
    if let Some(local) = dirs::data_local_dir() {
        let chrome = local.join("Google").join("Chrome").join("Application").join("chrome.exe");
        if chrome.exists() {
            return Some((chrome.to_string_lossy().to_string(), "chrome".to_string()));
        }
    }

    None
}

/// 保存悬浮窗几何信息（位置+尺寸）
#[tauri::command]
pub fn save_overlay_geometry(
    state: tauri::State<'_, SharedState>,
    geometry: WindowGeometry,
) -> Result<(), AppError> {
    GlobalConfig::save_overlay_geometry_fn(&state.app_data_dir, &geometry)
}

/// 加载悬浮窗几何信息
#[tauri::command]
pub fn load_overlay_geometry(
    state: tauri::State<'_, SharedState>,
) -> Result<Option<WindowGeometry>, AppError> {
    Ok(GlobalConfig::load_overlay_geometry_fn(&state.app_data_dir))
}

/// 保存当前选中的主题
#[tauri::command]
pub fn save_theme(
    state: tauri::State<'_, SharedState>,
    theme: String,
    window: tauri::Window,
) -> Result<(), AppError> {
    let mut config_lock = state.config.write();
    if let Some(ref mut cfg) = *config_lock {
        if window.label() == "overlay" {
            cfg.theme_overlay = theme;
        } else {
            cfg.theme = theme;
        }
        cfg.save(&state.app_data_dir)?;
    }
    Ok(())
}

/// 根据选择的浏览器类型（edge 或 chrome）自动探测路径
#[tauri::command]
pub fn detect_browser_path_by_type(browser_type: String) -> Option<String> {
    if browser_type == "edge" {
        let edge_candidates = [
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ];
        for p in &edge_candidates {
            if std::path::Path::new(p).exists() {
                return Some(p.to_string());
            }
        }
        if let Some(local) = dirs::data_local_dir() {
            let edge = local.join("Microsoft").join("Edge").join("Application").join("msedge.exe");
            if edge.exists() {
                return Some(edge.to_string_lossy().to_string());
            }
        }
    } else if browser_type == "chrome" {
        let chrome_candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ];
        for p in &chrome_candidates {
            if std::path::Path::new(p).exists() {
                return Some(p.to_string());
            }
        }
        if let Some(local) = dirs::data_local_dir() {
            let chrome = local.join("Google").join("Chrome").join("Application").join("chrome.exe");
            if chrome.exists() {
                return Some(chrome.to_string_lossy().to_string());
            }
        }
    }
    None
}
