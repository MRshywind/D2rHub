pub mod capturer;
pub mod preprocess;
pub mod engine;
pub mod pipeline;
pub mod fuzzy;
pub mod game_data;

use crate::commands::account::AccountMeta;
use crate::commands::global_config::GlobalConfig;
use pipeline::OcrMonitor;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Clone)]
pub struct OcrConfig {
    pub window_title: String,
    /// 目标游戏进程 PID（优先于 window_title，用于精确定位窗口）
    pub target_pid: Option<u32>,
    pub poll_interval_ms: u64,
    pub debug_output: bool,
    pub text_matcher_threshold: u8,
    pub rune_matcher_threshold: u8,
    pub use_cuda: bool,
    pub scene_text_color_rgb: [u8; 3],
    pub scene_text_color_range: [u8; 3],
    pub rune_text_color_rgb: [u8; 3],
    pub rune_text_color_range: [u8; 3],
    pub rune_background_color_rgb: [u8; 3],
    pub rune_background_color_range: [u8; 3],
}

impl OcrConfig {
    fn from_account(
        global_config: &GlobalConfig,
        account: &AccountMeta,
        target_pid: Option<u32>,
    ) -> Self {
        let window_title = if account.display_name.trim().is_empty() {
            account.id.clone()
        } else {
            account.display_name.clone()
        };

        Self {
            window_title,
            target_pid,
            poll_interval_ms: global_config.ocr_poll_interval_ms,
            debug_output: global_config.ocr_debug_output,
            text_matcher_threshold: default_text_matcher_threshold(),
            rune_matcher_threshold: default_rune_matcher_threshold(),
            use_cuda: false,
            scene_text_color_rgb: default_scene_text_color_rgb(),
            scene_text_color_range: default_scene_text_color_range(),
            rune_text_color_rgb: default_rune_text_color_rgb(),
            rune_text_color_range: default_rune_text_color_range(),
            rune_background_color_rgb: default_rune_background_color_rgb(),
            rune_background_color_range: default_rune_background_color_range(),
        }
    }
}

fn default_text_matcher_threshold() -> u8 { 67 }
fn default_rune_matcher_threshold() -> u8 { 67 }
fn default_scene_text_color_rgb() -> [u8; 3] { [202, 23, 0] }
fn default_scene_text_color_range() -> [u8; 3] { [10, 55, 55] }
fn default_rune_text_color_rgb() -> [u8; 3] { [255, 168, 0] }
fn default_rune_text_color_range() -> [u8; 3] { [10, 100, 75] }
fn default_rune_background_color_rgb() -> [u8; 3] { [0, 71, 141] }
fn default_rune_background_color_range() -> [u8; 3] { [10, 55, 55] }

/// 单次 OCR 文本结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrTextItem {
    pub text: String,
    pub source: String,
    pub timestamp: String,
    /// 符文编号（1-33），仅通道B 识别到符文时填充
    pub rune_number: Option<u32>,
    /// 高级符文截图相对路径（相对于 stateData 目录），仅 #24+ 符文填充
    pub screenshot_path: Option<String>,
    #[serde(default)]
    pub is_town: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rune_name_en: Option<String>,
}

/// 通道结果环形缓冲区
static CH_A_RESULTS: std::sync::OnceLock<Mutex<Vec<OcrTextItem>>> = std::sync::OnceLock::new();
static CH_B_RESULTS: std::sync::OnceLock<Mutex<Vec<OcrTextItem>>> = std::sync::OnceLock::new();
static MONITOR: std::sync::OnceLock<Mutex<Option<OcrMonitor>>> = std::sync::OnceLock::new();
static RUNNING: AtomicBool = AtomicBool::new(false);
static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn resolve_monitor_config(app: &tauri::AppHandle) -> Result<OcrConfig, String> {
    let state = app.state::<crate::state::SharedState>();
    let (global_config, account) = {
        let config = state.config.read();
        let global_config = config
            .as_ref()
            .ok_or_else(|| "尚未完成首次配置".to_string())?;
        let account = global_config
            .resolve_ocr_target_account()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "OCR 尚未启用".to_string())?;
        (global_config.clone(), account)
    };
    let target_pid = state
        .active_games
        .read()
        .get(&account.id)
        .copied()
        .or(account.running_pid);

    Ok(OcrConfig::from_account(&global_config, &account, target_pid))
}

fn mark_generation_stopped(generation: u64) {
    if GENERATION.load(Ordering::SeqCst) == generation {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

fn install_ocr_worker_panic_hook(debug_dir_for_panic: Option<std::path::PathBuf>) {
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!("PANIC in ocr-worker: {}", info);
        crate::logger::log_msg("ERROR", "OCR_WORKER", &msg);
        if let Some(file_path) = &debug_dir_for_panic {
            match std::fs::OpenOptions::new().create(true).append(true).open(file_path) {
                Ok(mut f) => {
                    let now = chrono::Local::now().format("%H:%M:%S.%3f");
                    use std::io::Write;
                    let _ = writeln!(f, "[{}] [FATAL] {}", now, msg);
                }
                Err(e) => eprintln!("[OCR] 无法写入 panic 日志: {} ({})", e, file_path.display()),
            }
        }
    }));
}

fn push_result(buf: &std::sync::OnceLock<Mutex<Vec<OcrTextItem>>>, item: OcrTextItem) {
    if let Some(lock) = buf.get() {
        let mut v = lock.lock().unwrap_or_else(|e| e.into_inner());
        v.push(item);
        if v.len() > 200 { let drop = v.len() - 200; v.drain(0..drop); }
    }
}

/// 获取通道A 最新结果并清空缓冲区
#[tauri::command]
pub fn get_ocr_ch_a_results() -> Vec<OcrTextItem> {
    let lock = CH_A_RESULTS.get_or_init(|| Mutex::new(Vec::new()));
    let mut buf = lock.lock().unwrap_or_else(|e| e.into_inner());
    let entries = buf.clone();
    buf.clear();
    entries
}

/// 获取通道B 最新结果并清空缓冲区
#[tauri::command]
pub fn get_ocr_ch_b_results() -> Vec<OcrTextItem> {
    let lock = CH_B_RESULTS.get_or_init(|| Mutex::new(Vec::new()));
    let mut buf = lock.lock().unwrap_or_else(|e| e.into_inner());
    let entries = buf.clone();
    buf.clear();
    entries
}

/// 启动 OCR 轮询 (2Hz)
#[tauri::command]
pub fn start_ocr_monitor(app: tauri::AppHandle) -> Result<(), String> {
    let config = resolve_monitor_config(&app)?;
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("OCR 监控器已在运行中".to_string());
    }

    // 从 AppState 获取 app_data_dir（用于所有 debug 输出，避免依赖 exe 路径）
    let app_data_dir = {
        let state = app.state::<crate::state::SharedState>();
        state.app_data_dir.clone()
    };
    let debug_out_dir = std::path::Path::new(&app_data_dir).join("test");

    // 清理上一次的调试输出（在写新日志之前）
    if config.debug_output {
        let _ = std::fs::remove_dir_all(&debug_out_dir);
    }
    if let Err(e) = std::fs::create_dir_all(&debug_out_dir) {
        eprintln!("[OCR Debug] 创建调试输出目录失败: {} ({})", debug_out_dir.display(), e);
    }

    // DO NOT call engine::init_engine() here!
    // If we call it here, OcrEngine is created on the Tauri Main Thread (STA),
    // which causes costly cross-apartment marshaling and deadlocks when accessed from the MTA worker thread.

    let monitor = OcrMonitor::new(config.clone(), app_data_dir.clone())
        .map_err(|e| {
            if config.debug_output {
                eprintln!("[OCR Error] OcrMonitor::new 失败: {}", e);
            }
            RUNNING.store(false, Ordering::SeqCst);
            e
        })?;

    let lock = MONITOR.get_or_init(|| Mutex::new(None));
    *lock.lock().unwrap_or_else(|e| e.into_inner()) = Some(monitor);
    CH_A_RESULTS.get_or_init(|| Mutex::new(Vec::new()));
    CH_B_RESULTS.get_or_init(|| Mutex::new(Vec::new()));

    let poll_ms = config.poll_interval_ms;
    let is_debug = config.debug_output;
    let use_cuda = config.use_cuda;

    let my_gen = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    std::thread::Builder::new().name("ocr-worker".into()).spawn(move || {
        let app_data_dir_clone = app_data_dir.clone();
        let debug_dir_for_panic: Option<std::path::PathBuf> = if is_debug {
            Some(std::path::Path::new(&app_data_dir_clone).join("test").join("ocr_debug.txt"))
        } else {
            None
        };
        install_ocr_worker_panic_hook(debug_dir_for_panic);

        // Initialize COM on this thread before calling any WinRT/COM APIs!
        // This prevents `RecognizeAsync` from silently hanging or crashing.
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED
            );
        }

        // Initialize OcrEngine on the MTA thread so it belongs to the MTA apartment.
        let resource_dir = app.path().resource_dir().ok();
        if let Err(e) = engine::init_engine(&app_data_dir, resource_dir.as_deref(), use_cuda) {
            eprintln!("[OCR Error] Failed to init engine on worker thread: {}", e);
            mark_generation_stopped(my_gen);
            unsafe { windows::Win32::System::Com::CoUninitialize(); }
            return;
        }

        std::thread::sleep(std::time::Duration::from_millis(100)); // give some time before first poll

        let lock = match MONITOR.get() {
            Some(l) => l,
            None => {
                return;
            }
        };
        let interval = std::time::Duration::from_millis(poll_ms);
        if is_debug {
            eprintln!("[OCR Debug] 监控器线程已启动，轮询间隔: {}ms", poll_ms);
        }

        let (watchdog_tx, watchdog_rx) = std::sync::mpsc::channel();
        let timeout_ms = std::cmp::max(5000, poll_ms * 3);

        // Watchdog thread
        std::thread::spawn(move || loop {
                match watchdog_rx.recv_timeout(std::time::Duration::from_millis(timeout_ms)) {
                    Ok(true) => { /* Heartbeat received */ }
                    Ok(false) => { break; }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        eprintln!("[OCR Error] OCR poll timeout ({}ms). Worker thread may be deadlocked.", timeout_ms);
                        mark_generation_stopped(my_gen);
                        break;
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        break;
                    }
                }
            });


        let mut current_interval = interval;

        loop {
            if !RUNNING.load(Ordering::SeqCst) || GENERATION.load(Ordering::SeqCst) != my_gen {
                break;
            }
            let start = std::time::Instant::now();

            let mon_opt = {
                let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
                guard.take()
            };

            if let Some(mut mon) = mon_opt {
                let _ = watchdog_tx.send(true);

                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    mon.poll();
                }));

                if let Err(err) = result {
                    eprintln!("[OCR Error] poll() panicked: {:?}", err);
                    break;
                }

                let mut guard = lock.lock().unwrap_or_else(|e| e.into_inner());
                // Only return the monitor if the OCR hasn't been stopped or restarted
                if RUNNING.load(Ordering::SeqCst) && GENERATION.load(Ordering::SeqCst) == my_gen {
                    *guard = Some(mon);
                }
            } else {
                break;
            }

            let elapsed = start.elapsed();

            // Self-adaptive dynamic frequency scaling of the polling interval
            if elapsed > current_interval / 2 {
                current_interval = std::cmp::min(
                    current_interval + std::time::Duration::from_millis(100),
                    interval * 4
                );
            } else {
                current_interval = std::cmp::max(
                    current_interval.saturating_sub(std::time::Duration::from_millis(50)),
                    interval
                );
            }

            if elapsed < current_interval {
                std::thread::sleep(current_interval - elapsed);
            }
        }

        let _ = watchdog_tx.send(false);
        mark_generation_stopped(my_gen);
        eprintln!("[OCR Info] Worker thread exited");

        // Clean up COM runtime before thread exit
        unsafe {
            windows::Win32::System::Com::CoUninitialize();
        }
    }).map_err(|e| {
        mark_generation_stopped(my_gen);
        format!("创建工作线程失败: {}", e)
    })?;

    Ok(())
}

/// 停止 OCR 轮询
#[tauri::command]
pub fn stop_ocr_monitor() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    RUNNING.store(false, Ordering::SeqCst);
    if let Some(lock) = MONITOR.get() {
        *lock.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

/// 使用已保存的全局配置原子地重启 OCR。
#[tauri::command]
pub fn restart_ocr_monitor(app: tauri::AppHandle) -> Result<(), String> {
    stop_ocr_monitor();
    start_ocr_monitor(app)
}
