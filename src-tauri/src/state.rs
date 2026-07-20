use parking_lot::RwLock;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::collections::HashMap;

use crate::commands::global_config::GlobalConfig;

/// 应用全局运行时状态
pub struct AppState {
    /// 全局配置（线程安全读写）
    pub config: RwLock<Option<GlobalConfig>>,
    /// 应用数据目录路径
    pub app_data_dir: String,
    /// 启动取消标志（前端点停止时置 true，启动循环检测到后中止）
    pub cancel_launch: AtomicBool,
    /// 正在运行的账号游戏 PID 映射：account_id -> d2r_pid
    pub active_games: RwLock<HashMap<String, u32>>,
    /// 快捷键内存映射缓存：lowercase_shortcut -> account_position (1-based)
    pub shortcut_map: RwLock<HashMap<String, usize>>,
}

impl AppState {
    pub fn new() -> Self {
        // 使用 exe 同目录下的 config 文件夹，而非系统 AppData
        let app_data = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|parent| parent.join("config")))
            .unwrap_or_else(|| std::path::PathBuf::from("./config"));

        Self {
            config: RwLock::new(None),
            app_data_dir: app_data.to_string_lossy().to_string(),
            cancel_launch: AtomicBool::new(false),
            active_games: RwLock::new(HashMap::new()),
            shortcut_map: RwLock::new(HashMap::new()),
        }
    }
}

pub type SharedState = Arc<AppState>;
