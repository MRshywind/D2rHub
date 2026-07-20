use std::path::Path;
use std::process::Command;
use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::Emitter;

use crate::commands::account::AccountManager;
use crate::commands::system::LaunchProgress;
use crate::commands::utils::silent_cmd;
use crate::error::AppError;
use crate::state::SharedState;

/// 启动进度详情
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchResult {
    pub account_id: String,
    pub success: bool,
    pub d2r_pid: Option<u32>,
    pub error: Option<String>,
    pub mutex_killed: bool,
}

const MUTEX_NAME: &str = "DiabloII Check For Other Instances";

/// 2026年6月 暴雪更新后常规进程数为7，未来若卡在等待登录需修改此阈值
const BNET_LOGIN_PROCESS_COUNT_THRESHOLD: usize = 7;

// ── 取消启动 ──

/// 前端点「停止」时调用，后端在下一个检查点中止所有未完成的账号
#[tauri::command]
pub fn cancel_launch(state: tauri::State<'_, SharedState>) -> Result<(), AppError> {
    state.cancel_launch.store(true, Ordering::SeqCst);
    Ok(())
}

/// 取消标志是否已置位
fn is_cancelled(state: &SharedState) -> bool {
    state.cancel_launch.load(Ordering::SeqCst)
}

fn account_path_error(account_id: &str, err: AppError) -> LaunchResult {
    LaunchResult {
        account_id: account_id.to_string(),
        success: false,
        d2r_pid: None,
        error: Some(err.to_string()),
        mutex_killed: false,
    }
}

fn checked_account_dir(
    config: &crate::commands::global_config::GlobalConfig,
    account_id: &str,
) -> Result<std::path::PathBuf, LaunchResult> {
    AccountManager::account_dir_checked(&config.accounts_dir, account_id)
        .map_err(|e| account_path_error(account_id, e))
}

/// 取消前检查战网状态：
/// - 已登录（进程≥7）：先优雅关闭战网让其 flush 注册表，再回写备份
/// - 运行中但未登录：直接强杀，不回写（注册表中是刚恢复的旧数据，无保存价值）
async fn cancel_with_cleanup(
    config: &crate::commands::global_config::GlobalConfig,
    account_id: &str,
) -> LaunchResult {
    let bnet_count = crate::commands::system::count_bnet_processes();
    let bnet_logged_in = bnet_count >= BNET_LOGIN_PROCESS_COUNT_THRESHOLD;

    if bnet_logged_in {
        crate::logger::log_msg(
            "INFO",
            "Launch",
            &format!(
                "[Account {}] 取消时检测到战网已登录 ({}进程)，先关闭战网再回写认证状态...",
                account_id, bnet_count
            ),
        );

        // 先优雅关闭战网（给 BNet 时间 flush 注册表），再读取并回写
        crate::commands::system::graceful_kill_bnet(30);
        std::thread::sleep(std::time::Duration::from_millis(500));

        let account_dir = match checked_account_dir(config, account_id) {
            Ok(dir) => dir,
            Err(res) => return res,
        };
        let config_clone = config.clone();
        let account_dir_clone = account_dir.clone();
        let sync_res = tokio::task::spawn_blocking(move || {
            crate::commands::account::sync_back_to_account(&account_dir_clone, &config_clone)
        })
        .await;

        match sync_res {
            Ok(Ok(())) => {
                crate::logger::log_msg(
                    "INFO",
                    "Launch",
                    &format!("[Account {}] 取消完成，认证状态已回写", account_id),
                );
            }
            Ok(Err(e)) => {
                crate::logger::log_msg(
                    "WARN",
                    "Launch",
                    &format!(
                        "[Account {}] 取消完成，但认证状态回写失败: {}",
                        account_id, e
                    ),
                );
            }
            Err(e) => {
                crate::logger::log_msg(
                    "WARN",
                    "Launch",
                    &format!(
                        "[Account {}] 取消完成，但认证状态回写线程异常: {:?}",
                        account_id, e
                    ),
                );
            }
        }
    } else if bnet_count > 0 {
        crate::logger::log_msg(
            "INFO",
            "Launch",
            &format!(
                "[Account {}] 取消时战网未登录 ({}进程)，直接关闭不保存",
                account_id, bnet_count
            ),
        );
        crate::commands::utils::kill_processes_by_name(&["Battle.net.exe", "Agent.exe"]);
    }

    LaunchResult {
        account_id: account_id.to_string(),
        success: false,
        d2r_pid: None,
        error: Some("启动已被用户取消".to_string()),
        mutex_killed: false,
    }
}

// ── 一键启动 ──

/// 只启动战网（不走游戏、互斥、连接等后续步骤）
#[tauri::command]
pub async fn launch_battle_net_only(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedState>,
    account_ids: Vec<String>,
) -> Result<Vec<LaunchResult>, AppError> {
    state.cancel_launch.store(false, Ordering::SeqCst);

    let config = {
        let cfg = state.config.read();
        cfg.clone()
            .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?
    };
    for account_id in &account_ids {
        AccountManager::validate_account_id(account_id)?;
    }

    let mut results = Vec::new();
    let total = account_ids.len();

    for (i, account_id) in account_ids.iter().enumerate() {
        if is_cancelled(&state) {
            emit_cancelled(&app, account_id);
            results.push(LaunchResult {
                account_id: account_id.to_string(),
                success: false,
                d2r_pid: None,
                error: Some("启动已被用户取消".to_string()),
                mutex_killed: false,
            });
            for remaining in &account_ids[i + 1..] {
                emit_cancelled(&app, remaining);
                results.push(LaunchResult {
                    account_id: remaining.to_string(),
                    success: false,
                    d2r_pid: None,
                    error: Some("启动已被用户取消".to_string()),
                    mutex_killed: false,
                });
            }
            return Ok(results);
        }

        let msg = format!("[{}/{}] 仅启动战网", i + 1, total);
        crate::logger::log_msg(
            "INFO",
            "Launch",
            &format!("[Account {}] [queue] [running]: {}", account_id, msg),
        );
        let _ = app.emit(
            "launch-progress",
            LaunchProgress::new(account_id, "queue", "running", &msg),
        );

        let result = launch_single_bnet_only(&app, &config, &state, account_id).await;
        crate::logger::log_msg(
            if result.success { "INFO" } else { "ERROR" },
            "Launch",
            &format!(
                "[Account {}] 仅启动战网结果: success={}, error={:?}",
                account_id, result.success, result.error
            ),
        );
        results.push(result);

        if i + 1 < total && !is_cancelled(&state) {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }

    Ok(results)
}

async fn prepare_bnet_environment(
    app: &tauri::AppHandle,
    config: &crate::commands::global_config::GlobalConfig,
    state: &SharedState,
    account_id: &str,
    wait_login: bool,
) -> Result<(), LaunchResult> {
    let emit = |step: &str, status: &str, msg: &str| {
        crate::logger::log_msg(
            "INFO",
            "Launch",
            &format!("[Account {}] [{}] [{}]: {}", account_id, step, status, msg),
        );
        let _ = app.emit(
            "launch-progress",
            LaunchProgress::new(account_id, step, status, msg),
        );
    };

    let cancelled = || -> LaunchResult {
        LaunchResult {
            account_id: account_id.to_string(),
            success: false,
            d2r_pid: None,
            error: Some("启动已被用户取消".to_string()),
            mutex_killed: false,
        }
    };

    // ── Step 1: 环境清理 ──
    emit("clean", "running", "正在清理战网和 Agent 进程...");
    let clean_res = tokio::task::spawn_blocking(|| {
        crate::commands::utils::kill_processes_by_name(&["Battle.net.exe", "Agent.exe"]);
    })
    .await;

    if clean_res.is_err() {
        emit("clean", "error", "清理环境线程异常");
        return Err(LaunchResult {
            account_id: account_id.to_string(),
            success: false,
            d2r_pid: None,
            error: Some("清理环境线程异常".to_string()),
            mutex_killed: false,
        });
    }

    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    emit("clean", "ok", "环境已清理");

    if is_cancelled(state) {
        emit("done", "error", "已取消");
        return Err(cancelled());
    }

    // ── Step 2: 配置覆盖 ──
    emit("copy", "running", "正在覆盖配置文件...");

    let accounts_dir = config.accounts_dir.clone();
    let app_data_roaming_bnet_path = config.app_data_roaming_bnet_path.clone();
    let saved_games_path = config.saved_games_path.clone();
    let account_id_str = account_id.to_string();

    let copy_res = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let account_dir = AccountManager::account_dir_checked(&accounts_dir, &account_id_str)
            .map_err(|e| e.to_string())?;

        // 2.1 复制 Battle.net Roaming 配置
        let bnet_src = account_dir.join("Battle.net");
        let bnet_dst = Path::new(&app_data_roaming_bnet_path);
        if bnet_src.exists() {
            if bnet_dst.exists() {
                let _ = std::fs::remove_dir_all(bnet_dst);
            }
            if let Err(e) = crate::commands::utils::copy_dir_recursive(&bnet_src, bnet_dst) {
                return Err(format!("复制 Battle.net 配置失败: {}", e));
            }
        }

        // 2.2 导入注册表（已初始化账号必须成功，否则战网无法自动登录）
        let json_path = account_dir.join("unified_auth.json");
        if json_path.exists() {
            crate::commands::account::restore_registry_from_json(&json_path)
                .map_err(|e| format!("恢复注册表失败: {}", e))?;
        } else {
            let reg_path = account_dir.join("unified_auth.reg");
            if reg_path.exists() {
                // ── 安全校验：读取 .reg 文件并扫描危险键路径 ──
                // Windows regedit 导出的 .reg 默认为 UTF-16LE（带 BOM），
                // read_to_string 只支持 UTF-8，故用原始字节 + BOM 检测解码
                let reg_bytes =
                    std::fs::read(&reg_path).map_err(|e| format!("读取注册表文件失败: {}", e))?;
                if reg_bytes.is_empty() {
                    return Err("注册表文件为空，导入被拒绝".to_string());
                }
                let reg_content = decode_reg_file(&reg_bytes).ok_or_else(|| {
                    "注册表文件编码无法识别（需 UTF-8 或 UTF-16LE），导入被拒绝".to_string()
                })?;
                let lower = reg_content.to_lowercase();
                if lower.contains(
                    "hkey_local_machine\\software\\microsoft\\windows\\currentversion\\run",
                ) || lower.contains("hkey_classes_root")
                {
                    crate::logger::log_msg(
                        "WARN",
                        "Launch",
                        &format!(
                            "[Account {}] .reg 文件包含可疑系统键路径，已拒绝导入",
                            account_id_str
                        ),
                    );
                    return Err(format!("注册表文件包含危险键路径，导入被拒绝"));
                }
                let output = silent_cmd("reg")
                    .args(["import", &reg_path.to_string_lossy()])
                    .output()
                    .map_err(|e| format!("执行 reg import 失败: {}", e))?;
                if !output.status.success() {
                    crate::logger::log_msg(
                        "WARN",
                        "Launch",
                        &format!(
                            "[Account {}] reg import 返回非零退出码: {}",
                            account_id_str,
                            String::from_utf8_lossy(&output.stderr)
                        ),
                    );
                }
            }
        }

        let meta_res = AccountManager::load_meta(&accounts_dir, &account_id_str);

        // 2.3 覆盖 Settings.json
        if meta_res
            .as_ref()
            .map(|meta| meta.has_customized_settings)
            .unwrap_or(false)
        {
            let src = account_dir.join("Settings.json");
            let dst = Path::new(&saved_games_path).join("Settings.json");
            if src.exists() {
                if let Some(parent) = dst.parent() {
                    if !parent.exists() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                }
                if dst.exists() {
                    let _ = std::fs::remove_file(&dst);
                }
                if let Err(e) = std::fs::copy(&src, &dst) {
                    return Err(format!("复制 Settings.json 失败: {}", e));
                }
            }
        } else {
            crate::logger::log_msg(
                "INFO",
                "Launch",
                &format!(
                    "[Account {}] 使用系统 Settings.json，跳过账号画质配置覆盖",
                    account_id_str
                ),
            );
        }

        let bnet_config_path = bnet_dst.join("Battle.net.config");

        // 2.3.5 注入 Mod 参数
        if let Ok(ref meta) = meta_res {
            if bnet_config_path.exists() {
                let _ =
                    crate::commands::account::inject_mod_args(&bnet_config_path, &meta.mod_args);
            }
        }

        // 2.4 强制确保 SingleInstance
        if let Err(e) = crate::commands::account::enforce_single_instance(&bnet_config_path) {
            crate::logger::log_msg(
                "WARN",
                "Launch",
                &format!(
                    "[Account {}] SingleInstance 校验失败: {}",
                    account_id_str, e
                ),
            );
        }

        Ok(())
    })
    .await;

    match copy_res {
        Ok(Ok(())) => {
            emit("copy", "ok", "配置文件覆盖完成");
        }
        Ok(Err(e)) => {
            emit("copy", "error", &e);
            return Err(LaunchResult {
                account_id: account_id.to_string(),
                success: false,
                d2r_pid: None,
                error: Some(e),
                mutex_killed: false,
            });
        }
        Err(_) => {
            let msg = "执行配置覆盖线程异常".to_string();
            emit("copy", "error", &msg);
            return Err(LaunchResult {
                account_id: account_id.to_string(),
                success: false,
                d2r_pid: None,
                error: Some(msg),
                mutex_killed: false,
            });
        }
    }

    if is_cancelled(state) {
        emit("done", "error", "已取消");
        return Err(cancelled());
    }

    // ── Step 3: 启动战网并等待登录 ──
    emit("launch", "running", "正在启动战网客户端...");

    let battle_net_path = config.battle_net_path.clone();
    // 基础安全校验：确保路径指向预期的可执行文件
    if !battle_net_path.to_lowercase().ends_with("battle.net.exe") {
        let msg = format!("战网路径异常，预期 Battle.net.exe: {}", battle_net_path);
        emit("launch", "error", &msg);
        return Err(LaunchResult {
            account_id: account_id.to_string(),
            success: false,
            d2r_pid: None,
            error: Some(msg),
            mutex_killed: false,
        });
    }
    let spawn_res =
        tokio::task::spawn_blocking(move || Command::new(&battle_net_path).spawn()).await;

    match spawn_res {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => {
            let msg = format!("启动战网失败: {}", e);
            emit("launch", "error", &msg);
            return Err(LaunchResult {
                account_id: account_id.to_string(),
                success: false,
                d2r_pid: None,
                error: Some(msg),
                mutex_killed: false,
            });
        }
        Err(_) => {
            let msg = "启动战网线程异常".to_string();
            emit("launch", "error", &msg);
            return Err(LaunchResult {
                account_id: account_id.to_string(),
                success: false,
                d2r_pid: None,
                error: Some(msg),
                mutex_killed: false,
            });
        }
    }

    if !wait_login {
        // 游戏新进程启动前由 launch_single 主循环重复检查并强杀 Agent.exe
        emit("launch", "ok", "战网客户端已启动，进入进程与 Agent 监控...");
    } else {
        let mut bnet_ready = false;
        for i in 1..=60 {
            if is_cancelled(state) {
                emit("done", "error", "已取消，正在保存状态...");
                return Err(cancel_with_cleanup(config, account_id).await);
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let count = crate::commands::system::count_bnet_processes();
            if count >= BNET_LOGIN_PROCESS_COUNT_THRESHOLD {
                bnet_ready = true;
                emit(
                    "launch",
                    "ok",
                    &format!("战网已登录 ({}s, {}进程)", i, count),
                );
                break;
            }
            if i % 5 == 0 {
                emit(
                    "launch",
                    "running",
                    &format!("等待战网登录... ({}s, {}进程)", i, count),
                );
            }
        }
        if !bnet_ready {
            emit("launch", "warning", "未检测到战网登录，但战网已启动");
        } else {
            // 登录成功，立即回写 token 快照作为检查点
            // 后续无论游戏崩溃、用户取消、还是进程被杀，至少保留一份刚登录时的有效 token
            emit("checkpoint", "running", "登录成功，保存认证检查点...");
            let account_dir = checked_account_dir(config, account_id)?;
            let config_clone = config.clone();
            let account_dir_clone = account_dir.clone();
            let sync_res = tokio::task::spawn_blocking(move || {
                crate::commands::account::sync_back_to_account(&account_dir_clone, &config_clone)
            })
            .await;
            match sync_res {
                Ok(Ok(())) => {
                    emit("checkpoint", "ok", "认证检查点已保存");
                }
                Ok(Err(e)) => {
                    emit(
                        "checkpoint",
                        "warning",
                        &format!("保存认证检查点失败: {}", e),
                    );
                }
                Err(_) => {
                    emit("checkpoint", "warning", "保存认证检查点线程异常");
                }
            }
        }
    }

    if is_cancelled(state) {
        emit("done", "error", "已取消，正在保存状态...");
        return Err(cancel_with_cleanup(config, account_id).await);
    }

    Ok(())
}

async fn launch_single_bnet_only(
    app: &tauri::AppHandle,
    config: &crate::commands::global_config::GlobalConfig,
    state: &SharedState,
    account_id: &str,
) -> LaunchResult {
    let emit = |step: &str, status: &str, msg: &str| {
        crate::logger::log_msg(
            "INFO",
            "Launch",
            &format!("[Account {}] [{}] [{}]: {}", account_id, step, status, msg),
        );
        let _ = app.emit(
            "launch-progress",
            LaunchProgress::new(account_id, step, status, msg),
        );
    };

    if let Err(res) = prepare_bnet_environment(app, config, state, account_id, true).await {
        return res;
    }

    // Step 4: 回写最新认证状态（战网登录后 token 可能已刷新）
    emit("cleanup", "running", "正在回写认证状态...");
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    let account_dir = match checked_account_dir(config, account_id) {
        Ok(dir) => dir,
        Err(res) => return res,
    };

    let config_clone = config.clone();
    let account_dir_clone = account_dir.clone();
    let sync_res = tokio::task::spawn_blocking(move || {
        crate::commands::account::sync_back_to_account(&account_dir_clone, &config_clone)
    })
    .await;

    match sync_res {
        Ok(Ok(())) => {
            emit("cleanup", "ok", "认证状态已同步");
        }
        Ok(Err(e)) => {
            emit("cleanup", "warning", &format!("回写状态失败: {}", e));
        }
        Err(_) => {
            emit("cleanup", "warning", "回写状态线程异常");
        }
    }

    emit("done", "ok", "战网启动完成（仅启动战网）");
    LaunchResult {
        account_id: account_id.to_string(),
        success: true,
        d2r_pid: None,
        error: None,
        mutex_killed: false,
    }
}

/// 一键启动选中的账号列表
/// 逐个串行启动：一个账号完整走完（清理→覆盖→启动战网→游戏→清互斥→连接→关战网）
/// 再开始下一个。两个账号之间留 2 秒缓冲。
#[tauri::command]
pub async fn launch_accounts(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedState>,
    account_ids: Vec<String>,
) -> Result<Vec<LaunchResult>, AppError> {
    // 每次启动前重置取消标志
    state.cancel_launch.store(false, Ordering::SeqCst);

    let config = {
        let cfg = state.config.read();
        cfg.clone()
            .ok_or_else(|| AppError::ConfigReadError("尚未完成首次配置".to_string()))?
    };
    for account_id in &account_ids {
        AccountManager::validate_account_id(account_id)?;
    }

    let mut results = Vec::new();
    let total = account_ids.len();

    for (i, account_id) in account_ids.iter().enumerate() {
        // 每个账号启动前检查取消标志
        if is_cancelled(&state) {
            emit_cancelled(&app, account_id);
            results.push(LaunchResult {
                account_id: account_id.to_string(),
                success: false,
                d2r_pid: None,
                error: Some("启动已被用户取消".to_string()),
                mutex_killed: false,
            });
            // 剩余未启动的账号也标记为取消
            for remaining in &account_ids[i + 1..] {
                emit_cancelled(&app, remaining);
                results.push(LaunchResult {
                    account_id: remaining.to_string(),
                    success: false,
                    d2r_pid: None,
                    error: Some("启动已被用户取消".to_string()),
                    mutex_killed: false,
                });
            }
            return Ok(results);
        }

        let msg = format!("[{}/{}] 开始启动账号", i + 1, total);
        crate::logger::log_msg(
            "INFO",
            "Launch",
            &format!("[Account {}] [queue] [running]: {}", account_id, msg),
        );
        let _ = app.emit(
            "launch-progress",
            LaunchProgress::new(account_id, "queue", "running", &msg),
        );

        let result = launch_single(&app, &config, &state, account_id).await;
        let killed = result.mutex_killed;
        let success = result.success;
        let pid = result.d2r_pid;
        let err = result.error.clone();
        crate::logger::log_msg(
            if success { "INFO" } else { "ERROR" },
            "Launch",
            &format!(
                "[Account {}] 启动结果: success={}, pid={:?}, error={:?}, mutex_killed={}",
                account_id, success, pid, err, killed
            ),
        );
        results.push(result);

        // 互斥句柄未清除则停止启动后续账号
        if success && !killed && i + 1 < total {
            let _ = app.emit(
                "launch-progress",
                LaunchProgress::new(
                    account_id,
                    "queue",
                    "warning",
                    "未检测到互斥句柄，后续账号暂停启动",
                ),
            );
            for remaining in &account_ids[i + 1..] {
                emit_cancelled(&app, remaining);
                results.push(LaunchResult {
                    account_id: remaining.to_string(),
                    success: false,
                    d2r_pid: None,
                    error: Some("互斥句柄未清除，已暂停".to_string()),
                    mutex_killed: false,
                });
            }
            return Ok(results);
        }

        // 如果还有下一个账号，等 2 秒让系统稳定
        if i + 1 < total && !is_cancelled(&state) {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    }

    Ok(results)
}

fn emit_cancelled(app: &tauri::AppHandle, account_id: &str) {
    crate::logger::log_msg(
        "INFO",
        "Launch",
        &format!("[Account {}] 启动已被用户取消", account_id),
    );
    let _ = app.emit(
        "launch-progress",
        LaunchProgress::new(account_id, "done", "error", "已取消"),
    );
}

async fn launch_single(
    app: &tauri::AppHandle,
    config: &crate::commands::global_config::GlobalConfig,
    state: &SharedState,
    account_id: &str,
) -> LaunchResult {
    let emit = |step: &str, status: &str, msg: &str| {
        crate::logger::log_msg(
            "INFO",
            "Launch",
            &format!("[Account {}] [{}] [{}]: {}", account_id, step, status, msg),
        );
        let _ = app.emit(
            "launch-progress",
            LaunchProgress::new(account_id, step, status, msg),
        );
    };

    let _cancelled = || -> LaunchResult {
        LaunchResult {
            account_id: account_id.to_string(),
            success: false,
            d2r_pid: None,
            error: Some("启动已被用户取消".to_string()),
            mutex_killed: false,
        }
    };

    // ── Token 过期检查（仅战网模式）──
    let meta_opt = AccountManager::load_meta(&config.accounts_dir, account_id).ok();
    if let Some(ref meta) = meta_opt {
        if meta.auth_mode.as_deref() != Some("token")
            && crate::commands::account::is_token_expired(&meta.last_reset_at)
        {
            return LaunchResult {
                account_id: account_id.to_string(),
                success: false,
                d2r_pid: None,
                error: Some("Token 已过期（超过30天），请重新初始化账号".to_string()),
                mutex_killed: false,
            };
        }
    }

    let is_token_auth = meta_opt.as_ref().and_then(|m| m.auth_mode.as_deref()) == Some("token");
    if is_token_auth {
        return launch_single_token(app, config, state, account_id, meta_opt.as_ref().unwrap())
            .await;
    }

    if let Err(res) = prepare_bnet_environment(app, config, state, account_id, false).await {
        return res;
    }

    // ── Step 4: 记录当前 D2R 进程快照 ──
    let before_pids = crate::commands::system::snapshot_processes("D2R.exe".to_string());

    // ── Step 5 & 6: 发送游戏启动指令并等待新 D2R 进程 ──
    emit("game", "running", "正在启动游戏进程...");

    let mut locked_agent_pid: Option<u32> = None;
    let mut first_agent_killed = false;
    let mut agent_locked_at: Option<std::time::Instant> = None;
    let mut last_launch_sent: Option<std::time::Instant> = None;
    let mut d2r_pid_opt: Option<u32> = None;
    let mut sys = sysinfo::System::new(); // 优化：复用 System 实例以提高效率
                                          // 跟踪已尝试 kill 的 Agent PID，避免重复日志洪水
    let mut killed_agent_pids: std::collections::HashSet<u32> = std::collections::HashSet::new();

    let wait_start = std::time::Instant::now();
    let timeout_secs = 60;

    while wait_start.elapsed().as_secs() < timeout_secs {
        if is_cancelled(state) {
            emit("done", "error", "已取消，正在保存状态...");
            return cancel_with_cleanup(config, account_id).await;
        }

        struct SysStatus {
            agent_pids: Vec<u32>,
            bnet_count: usize,
            d2r_pids: Vec<u32>,
        }

        let (status, sys_ret) = tokio::task::spawn_blocking(move || {
            sys.refresh_processes(sysinfo::ProcessesToUpdate::All);

            let mut agent_pids = Vec::new();
            let mut bnet_count = 0;
            let mut d2r_pids = Vec::new();

            for (pid, proc) in sys.processes() {
                let name = proc.name().to_string_lossy();
                if name.eq_ignore_ascii_case("Agent.exe") {
                    agent_pids.push(pid.as_u32());
                } else if name == "Battle.net.exe" {
                    bnet_count += 1;
                } else if name == "D2R.exe" {
                    d2r_pids.push(pid.as_u32());
                }
            }

            (
                SysStatus {
                    agent_pids,
                    bnet_count,
                    d2r_pids,
                },
                sys,
            )
        })
        .await
        .unwrap_or((
            SysStatus {
                agent_pids: Vec::new(),
                bnet_count: 0,
                d2r_pids: Vec::new(),
            },
            sysinfo::System::new(),
        ));
        sys = sys_ret;

        // 1. 检查是否有新进程
        let mut found_new = false;
        for pid in &status.d2r_pids {
            if !before_pids.contains(pid) {
                d2r_pid_opt = Some(*pid);
                found_new = true;
                break;
            }
        }
        if found_new {
            break;
        }

        // 2. 检测 Agent.exe 进程并锁定 (模式3跳过)
        if config.agent_mode != 3 && !first_agent_killed {
            if let Some(pid) = locked_agent_pid {
                if !status.agent_pids.contains(&pid) {
                    locked_agent_pid = None;
                    agent_locked_at = None;
                }
            }
            if locked_agent_pid.is_none() {
                if let Some(&first_pid) = status.agent_pids.first() {
                    locked_agent_pid = Some(first_pid);
                    agent_locked_at = Some(std::time::Instant::now());
                    emit(
                        "game",
                        "running",
                        &format!("已锁定战网 Agent 进程 (PID: {})", first_pid),
                    );
                }
            }
        }

        // 3. Agent 杀一次逻辑：根据多开模式决定何时杀 (模式3跳过)
        if config.agent_mode != 3 {
            if !first_agent_killed {
                if let Some(agent_pid) = locked_agent_pid {
                    let should_kill = match config.agent_mode {
                        2 => status.bnet_count >= config.agent_threshold as usize,
                        _ => {
                            // 模式1 (默认): 从 Agent 被锁定起等待 agent_delay_secs 秒
                            agent_locked_at
                                .map(|t| t.elapsed().as_secs_f64() >= config.agent_delay_secs)
                                .unwrap_or(false)
                        }
                    };
                    if should_kill {
                        let agent_pid_copy = agent_pid;
                        let _ = tokio::task::spawn_blocking(move || {
                            let _ = silent_cmd("taskkill")
                                .args(["/F", "/PID", &agent_pid_copy.to_string()])
                                .output();
                        })
                        .await;
                        first_agent_killed = true;
                        locked_agent_pid = None; // Reset
                        if config.agent_mode == 1 {
                            emit(
                                "game",
                                "running",
                                &format!(
                                    "Agent 存活 {}s 后已终止 (PID: {})",
                                    config.agent_delay_secs, agent_pid
                                ),
                            );
                        } else {
                            emit(
                                "game",
                                "running",
                                &format!(
                                    "战网进程数达到 {} (≥{})，已终止 Agent (PID: {})",
                                    status.bnet_count, config.agent_threshold, agent_pid
                                ),
                            );
                        }
                    }
                }
            } else {
                // 后续追着杀：查到就秒杀（每次都执行 taskkill，仅首次 emit 日志）
                for &pid in &status.agent_pids {
                    let first_seen = killed_agent_pids.insert(pid);
                    let _ = tokio::task::spawn_blocking(move || {
                        let _ = silent_cmd("taskkill")
                            .args(["/F", "/PID", &pid.to_string()])
                            .output();
                    })
                    .await;
                    if first_seen {
                        emit(
                            "game",
                            "running",
                            &format!("检测到新生 Agent 进程，已立即秒杀 (PID: {})", pid),
                        );
                    }
                }
            }
        }

        // 4. 判断 Battle.net.exe 数量是否大于 5，只有大于 5 才发送游戏启动指令
        if status.bnet_count > 5 {
            let should_send = match last_launch_sent {
                None => true,
                Some(last) => last.elapsed() >= std::time::Duration::from_secs(5),
            };

            if should_send {
                let battle_net_path = config.battle_net_path.clone();
                emit(
                    "game",
                    "running",
                    &format!(
                        "战网进程数达到 {} (>5)，发送游戏启动指令...",
                        status.bnet_count
                    ),
                );
                let _ = tokio::task::spawn_blocking(move || {
                    Command::new(&battle_net_path)
                        .arg("--exec=launch OSI")
                        .spawn()
                })
                .await;
                last_launch_sent = Some(std::time::Instant::now());
            }
        } else {
            if last_launch_sent.is_none() {
                emit(
                    "game",
                    "running",
                    &format!(
                        "等待战网客户端加载... (当前战网进程数: {})",
                        status.bnet_count
                    ),
                );
            }
        }

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    let d2r_pid = match d2r_pid_opt {
        Some(pid) => {
            emit("game", "ok", &format!("游戏进程已启动 (PID: {})", pid));
            {
                let mut active = state.active_games.write();
                active.insert(account_id.to_string(), pid);
            }
            // 将游戏窗口标题改为账号昵称，并调整窗口位置（如已配置）
            if let Ok(meta) = AccountManager::load_meta(&config.accounts_dir, account_id) {
                let win_title = if meta.display_name.is_empty() {
                    account_id.to_string()
                } else {
                    meta.display_name.clone()
                };
                let win_x = meta.window_x;
                let win_y = meta.window_y;
                // 延迟重试 + 位置持续轮询
                let pid_copy = pid;
                let title_copy = win_title.clone();
                let accounts_dir = config.accounts_dir.clone();
                let account_id_owned = account_id.to_string();
                tokio::task::spawn_blocking(move || {
                    // Phase 1: 10 次重试重命名 + 初始定位
                    for _ in 0..10 {
                        std::thread::sleep(std::time::Duration::from_millis(800));
                        crate::commands::system::rename_game_window(pid_copy, &title_copy);
                        if let (Some(x), Some(y)) = (win_x, win_y) {
                            crate::commands::system::set_game_window_position(pid_copy, x, y);
                        }
                    }
                    // Phase 2: 窗口位置轮询，拖动停止后反向写入账号配置
                    let mut sys = sysinfo::System::new();
                    let sys_pid = sysinfo::Pid::from(pid_copy as usize);
                    let mut last_pos: Option<(i32, i32)> = None;
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[sys_pid]));
                        let alive = sys
                            .process(sys_pid)
                            .map(|p| p.name().to_string_lossy().eq_ignore_ascii_case("D2R.exe"))
                            .unwrap_or(false);
                        if !alive {
                            break;
                        }
                        if let Some(hwnd) = crate::commands::system::find_game_hwnd(pid_copy) {
                            if let Some(pos) = crate::commands::system::get_window_rect(hwnd) {
                                // 过滤最小化时的异常坐标（Windows 对最小化窗口返回 ~-32000）
                                if pos.0 > -10000 && pos.1 > -10000 && last_pos != Some(pos) {
                                    last_pos = Some(pos);
                                    if let Ok(mut meta) =
                                        AccountManager::load_meta(&accounts_dir, &account_id_owned)
                                    {
                                        meta.window_x = Some(pos.0);
                                        meta.window_y = Some(pos.1);
                                        let _ = AccountManager::save_meta(&accounts_dir, &meta);
                                    }
                                }
                            }
                        }
                    }
                });
            }
            pid
        }
        None => {
            emit("game", "error", "等待游戏进程启动超时");
            return LaunchResult {
                account_id: account_id.to_string(),
                success: false,
                d2r_pid: None,
                error: Some("等待游戏进程启动超时".to_string()),
                mutex_killed: false,
            };
        }
    };

    if is_cancelled(state) {
        emit("done", "error", "已取消，正在保存状态...");
        return cancel_with_cleanup(config, account_id).await;
    }

    // ── Step 7: 互斥句柄清除 (后台任务，与 Step 8 并发) ──
    let mutex_killed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mutex_found_once = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mutex_task = {
        let killed = mutex_killed.clone();
        let found = mutex_found_once.clone();
        let state_clone = state.clone();
        tokio::spawn(async move {
            loop {
                if is_cancelled(&state_clone) {
                    break;
                }
                match crate::commands::system::find_mutex_handle(d2r_pid, MUTEX_NAME) {
                    Ok(Some(hid)) => {
                        found.store(true, std::sync::atomic::Ordering::SeqCst);
                        let _ = crate::commands::system::close_handle(d2r_pid, &hid);
                        match crate::commands::system::find_mutex_handle(d2r_pid, MUTEX_NAME) {
                            Ok(None) | Err(_) => {
                                killed.store(true, std::sync::atomic::Ordering::SeqCst);
                                break;
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        })
    };

    // ── Step 8: 自动按键 + 连接检测 ──
    emit("connect", "running", "正在跳过动画并等待服务器连接...");
    emit("mutex", "running", "后台监控互斥句柄中...");

    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(60);
    let mut connected = false;

    // 先等 2 秒让游戏窗口初始化
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    let mut keys_logged = false;
    while !connected && start.elapsed() < timeout {
        if is_cancelled(state) {
            emit("done", "error", "已取消，正在保存状态...");
            mutex_task.abort();
            return cancel_with_cleanup(config, account_id).await;
        }

        let _ = crate::commands::system::send_keys_to_window(d2r_pid);
        if !keys_logged {
            emit("connect", "running", "正在发送按键跳过动画...");
            keys_logged = true;
        }

        if crate::commands::system::check_game_connected(d2r_pid) {
            connected = true;
            emit("connect", "ok", "游戏已连接到大厅服务器");
            break;
        }

        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    if !connected {
        emit("connect", "error", "连接服务器超时");
        mutex_task.abort();
        return LaunchResult {
            account_id: account_id.to_string(),
            success: false,
            d2r_pid: None,
            error: Some("连接服务器超时".to_string()),
            mutex_killed: false,
        };
    }

    // ── lobby 已连接，等待互斥句柄确认（最多 3s）──
    if !mutex_killed.load(std::sync::atomic::Ordering::SeqCst) {
        emit("mutex", "running", "等待互斥句柄确认...");
        let mutex_deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while std::time::Instant::now() < mutex_deadline {
            if is_cancelled(state) {
                emit("done", "error", "已取消，正在保存状态...");
                mutex_task.abort();
                return cancel_with_cleanup(config, account_id).await;
            }
            if mutex_killed.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }

    if mutex_killed.load(std::sync::atomic::Ordering::SeqCst) {
        emit("mutex", "ok", "互斥句柄已清除");
    } else if mutex_found_once.load(std::sync::atomic::Ordering::SeqCst) {
        emit("mutex", "warning", "互斥句柄曾检测到但清除失败");
    } else {
        emit(
            "mutex",
            "warning",
            "未检测到互斥句柄，下一个游戏可能无法成功启动",
        );
    }

    // ── Step 9: 优雅关闭战网 → 等待退出 → 回写最新状态 ──
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    let graceful = crate::commands::system::graceful_kill_bnet(30);
    if !graceful {
        emit("cleanup", "warning", "战网未能优雅关闭，已回退强制关闭");
    }
    emit("cleanup", "running", "正在回写最新认证状态...");

    let account_dir = match checked_account_dir(config, account_id) {
        Ok(dir) => dir,
        Err(res) => return res,
    };
    let config_clone = config.clone();
    let account_dir_clone = account_dir.clone();
    let sync_res = tokio::task::spawn_blocking(move || {
        crate::commands::account::sync_back_to_account(&account_dir_clone, &config_clone)
    })
    .await;

    match sync_res {
        Ok(Ok(())) => {
            emit("cleanup", "ok", "战网已关闭，状态已同步");
        }
        Ok(Err(e)) => {
            emit("cleanup", "warning", &format!("回写状态失败: {}", e));
        }
        Err(_) => {
            emit("cleanup", "warning", "回写状态线程异常");
        }
    }

    // 更新最后启动时间
    let accounts_dir_clone = config.accounts_dir.clone();
    let account_id_clone = account_id.to_string();
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(mut meta) = AccountManager::load_meta(&accounts_dir_clone, &account_id_clone) {
            meta.last_launched_at = Some(chrono::Utc::now().to_rfc3339());
            let _ = AccountManager::save_meta(&accounts_dir_clone, &meta);
        }
    })
    .await;

    mutex_task.abort();

    emit("done", "ok", "启动完成");
    LaunchResult {
        account_id: account_id.to_string(),
        success: true,
        d2r_pid: Some(d2r_pid),
        error: None,
        mutex_killed: mutex_killed.load(std::sync::atomic::Ordering::SeqCst),
    }
}

async fn launch_single_token(
    app: &tauri::AppHandle,
    config: &crate::commands::global_config::GlobalConfig,
    state: &SharedState,
    account_id: &str,
    meta: &crate::commands::account::AccountMeta,
) -> LaunchResult {
    let emit = |step: &str, status: &str, msg: &str| {
        crate::logger::log_msg(
            "INFO",
            "Launch",
            &format!("[Account {}] [{}] [{}]: {}", account_id, step, status, msg),
        );
        let _ = app.emit(
            "launch-progress",
            LaunchProgress::new(account_id, step, status, msg),
        );
    };

    let cancelled = || -> LaunchResult {
        LaunchResult {
            account_id: account_id.to_string(),
            success: false,
            d2r_pid: None,
            error: Some("启动已被用户取消".to_string()),
            mutex_killed: false,
        }
    };

    emit("clean", "running", "正在清理环境变量...");
    if is_cancelled(state) {
        emit("done", "error", "已取消");
        return cancelled();
    }

    emit("copy", "running", "正在准备注册表与 Settings.json...");
    let account_dir = match checked_account_dir(config, account_id) {
        Ok(dir) => dir,
        Err(res) => return res,
    };
    let saved_games_path = config.saved_games_path.clone();

    // 1. 覆盖 Settings.json
    if meta.has_customized_settings {
        let src = account_dir.join("Settings.json");
        let dst = std::path::Path::new(&saved_games_path).join("Settings.json");
        if src.exists() {
            if let Some(parent) = dst.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::copy(&src, &dst);
        }
    } else {
        crate::logger::log_msg(
            "INFO",
            "Launch",
            &format!(
                "[Account {}] Token 启动使用系统 Settings.json，跳过账号画质配置覆盖",
                account_id
            ),
        );
    }

    // 2. 写入 Token 到注册表
    let protected_bytes = match &meta.token {
        Some(t) => {
            // Token 在 account.json 中以 hex(DPAPI加密结果) 形式存储，
            // 直接解码后写入注册表即可，D2R 会自行调用 CryptUnprotectData 解密
            match crate::commands::crypto::hex_decode(t) {
                Ok(bytes) => bytes,
                Err(e) => {
                    return LaunchResult {
                        account_id: account_id.to_string(),
                        success: false,
                        d2r_pid: None,
                        error: Some(format!("Token 解码失败: {}", e)),
                        mutex_killed: false,
                    };
                }
            }
        }
        None => {
            return LaunchResult {
                account_id: account_id.to_string(),
                success: false,
                d2r_pid: None,
                error: Some("账号缺少 Token".to_string()),
                mutex_killed: false,
            };
        }
    };

    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok((key, _)) =
            hkcu.create_subkey(r"Software\Blizzard Entertainment\Battle.net\Launch Options\OSI")
        {
            let region = meta.region.as_deref().unwrap_or("CN");
            let _ = key.set_value("REGION", &region);
            let default_locale = match region {
                "KR" | "Global" => "zhTW",
                "NA" | "EU" => "enUS",
                _ => "zhCN",
            };
            let locale = meta.language.as_deref().unwrap_or(default_locale);
            let audio = meta.voicelanguage.as_deref().unwrap_or(default_locale);
            let _ = key.set_value("LOCALE", &locale);
            let _ = key.set_value("LOCALE_AUDIO", &audio);

            let val = winreg::RegValue {
                bytes: protected_bytes,
                vtype: RegType::REG_BINARY,
            };
            let _ = key.set_raw_value("WEB_TOKEN", &val);
        }
    }
    emit("copy", "ok", "配置覆盖完成");

    // 3. 记录之前存在的 D2R 进程
    let before_pids = crate::commands::system::snapshot_processes("D2R.exe".to_string());

    emit("game", "running", "正在直接启动 D2R.exe...");
    // 4. 启动 D2R.exe
    let game_path = Path::new(&config.game_path)
        .join("D2R.exe")
        .to_string_lossy()
        .to_string();
    let region = meta.region.as_deref().unwrap_or("CN");
    let uid_arg = if region == "CN" { "osic" } else { "OSI" };

    let mut cmd = Command::new(&game_path);
    cmd.arg("-uid").arg(uid_arg);

    if !meta.mod_args.is_empty() {
        let args: Vec<&str> = meta.mod_args.split_whitespace().collect();
        cmd.args(args);
    }

    let spawn_res = tokio::task::spawn_blocking(move || cmd.spawn()).await;
    match spawn_res {
        Ok(Ok(_)) => {}
        _ => {
            return LaunchResult {
                account_id: account_id.to_string(),
                success: false,
                d2r_pid: None,
                error: Some("启动 D2R.exe 失败".to_string()),
                mutex_killed: false,
            };
        }
    }

    // 5. 等待进程
    let mut d2r_pid_opt: Option<u32> = None;
    let mut sys = sysinfo::System::new();
    let wait_start = std::time::Instant::now();
    let timeout_secs = 60;

    while wait_start.elapsed().as_secs() < timeout_secs {
        if is_cancelled(state) {
            return cancelled();
        }

        let (d2r_pids, sys_ret) = tokio::task::spawn_blocking(move || {
            sys.refresh_processes(sysinfo::ProcessesToUpdate::All);
            let mut pids = Vec::new();
            for (pid, proc) in sys.processes() {
                if proc
                    .name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case("D2R.exe")
                {
                    pids.push(pid.as_u32());
                }
            }
            (pids, sys)
        })
        .await
        .unwrap();
        sys = sys_ret;

        for pid in &d2r_pids {
            if !before_pids.contains(pid) {
                d2r_pid_opt = Some(*pid);
                break;
            }
        }
        if d2r_pid_opt.is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    let d2r_pid = match d2r_pid_opt {
        Some(pid) => {
            emit("game", "ok", &format!("游戏进程已启动 (PID: {})", pid));
            let mut active = state.active_games.write();
            active.insert(account_id.to_string(), pid);

            let win_title = if meta.display_name.is_empty() {
                account_id.to_string()
            } else {
                meta.display_name.clone()
            };
            let win_x = meta.window_x;
            let win_y = meta.window_y;
            let pid_copy = pid;
            tokio::task::spawn_blocking(move || {
                for _ in 0..10 {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    crate::commands::system::rename_game_window(pid_copy, &win_title);
                    if let (Some(x), Some(y)) = (win_x, win_y) {
                        crate::commands::system::set_game_window_position(pid_copy, x, y);
                    }
                }
            });
            pid
        }
        None => {
            emit("game", "error", "等待游戏进程启动超时");
            return LaunchResult {
                account_id: account_id.to_string(),
                success: false,
                d2r_pid: None,
                error: Some("等待游戏进程启动超时".to_string()),
                mutex_killed: false,
            };
        }
    };

    // ── 杀 Mutex ──
    let mutex_killed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mutex_task = {
        let killed = mutex_killed.clone();
        tokio::spawn(async move {
            for _ in 0..60 {
                match crate::commands::system::find_mutex_handle(d2r_pid, MUTEX_NAME) {
                    Ok(Some(hid)) => {
                        let _ = crate::commands::system::close_handle(d2r_pid, &hid);
                        killed.store(true, std::sync::atomic::Ordering::SeqCst);
                        break;
                    }
                    _ => {}
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        })
    };

    // ── 连接检测与跳过动画 ──
    emit("connect", "running", "正在跳过动画并等待服务器连接...");
    emit("mutex", "running", "后台监控互斥句柄中...");

    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(60);
    let mut connected = false;

    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    while !connected && start.elapsed() < timeout {
        if is_cancelled(state) {
            mutex_task.abort();
            return cancelled();
        }

        let _ = crate::commands::system::send_keys_to_window(d2r_pid);

        if crate::commands::system::check_game_connected(d2r_pid) {
            connected = true;
            emit("connect", "ok", "游戏已连接到大厅服务器");
            break;
        }

        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    if !connected {
        emit("connect", "error", "连接服务器超时");
        mutex_task.abort();
        return LaunchResult {
            account_id: account_id.to_string(),
            success: false,
            d2r_pid: None,
            error: Some("连接服务器超时".to_string()),
            mutex_killed: false,
        };
    }

    if mutex_killed.load(std::sync::atomic::Ordering::SeqCst) {
        emit("mutex", "ok", "互斥句柄已清除");
    }

    // 更新最后启动时间
    let accounts_dir_clone = config.accounts_dir.clone();
    let account_id_clone = account_id.to_string();
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(mut meta) = AccountManager::load_meta(&accounts_dir_clone, &account_id_clone) {
            meta.last_launched_at = Some(chrono::Utc::now().to_rfc3339());
            let _ = AccountManager::save_meta(&accounts_dir_clone, &meta);
        }
    })
    .await;

    emit("done", "ok", "启动完成");
    LaunchResult {
        account_id: account_id.to_string(),
        success: true,
        d2r_pid: Some(d2r_pid),
        error: None,
        mutex_killed: mutex_killed.load(std::sync::atomic::Ordering::SeqCst),
    }
}

// ── 工具函数 ──

/// 解码 .reg 注册表文件内容为 String。
/// Windows regedit 导出默认 UTF-16LE（BOM 0xFF 0xFE），也兼容 UTF-8（含或不含 BOM）。
/// 返回 None 表示文件编码无法识别或解码失败——调用方应拒绝导入（Fail-Safe）。
fn decode_reg_file(raw: &[u8]) -> Option<String> {
    if raw.len() >= 2 && raw[0] == 0xFF && raw[1] == 0xFE {
        // UTF-16LE with BOM
        let u16_bytes = &raw[2..];
        if u16_bytes.len() % 2 != 0 {
            return None;
        }
        let u16_words: Vec<u16> = u16_bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16(&u16_words).ok()
    } else if raw.len() >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF {
        // UTF-8 with BOM
        String::from_utf8(raw[3..].to_vec()).ok()
    } else {
        // Assume UTF-8 without BOM (or plain ASCII)
        String::from_utf8(raw.to_vec()).ok()
    }
}
