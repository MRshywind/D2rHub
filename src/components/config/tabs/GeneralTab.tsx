import { Globe, RefreshCw, RotateCw, FolderOpen, Settings2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useGlobalConfig } from "../../../store/globalConfig";
import { Toggle } from "../../ui/Toggle";

interface Props {
  onRepairAll: () => void;
  onReconfigure: () => void;
}

export function GeneralTab({ onRepairAll, onReconfigure }: Props) {
  const { config, save } = useGlobalConfig();

  if (!config) return null;

  const agentMode = config.agent_mode ?? 1;
  const agentDelaySecs = config.agent_delay_secs ?? 1;
  const agentThreshold = config.agent_threshold ?? 5;

  return (
    <div className="space-y-3">
      {/* ── Agent 多开模式 ── */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-text-muted uppercase tracking-wider block mb-1">多开 Agent 模式</span>

        {/* Mode selector */}
        <div className="flex gap-2">
          <button
            onClick={async () => { await save({ ...config, agent_mode: 1 }); }}
            className={`flex-1 px-3 py-2 rounded-xl text-md font-medium transition-all duration-150 border ${
              agentMode === 1
                ? "border-accent bg-accent/10 text-accent"
                : "border-border-default text-text-secondary hover:text-text-primary"
            }`}
          >
            模式1：延时杀
          </button>
          <button
            onClick={async () => { await save({ ...config, agent_mode: 2 }); }}
            className={`flex-1 px-3 py-2 rounded-xl text-md font-medium transition-all duration-150 border ${
              agentMode === 2
                ? "border-accent bg-accent/10 text-accent"
                : "border-border-default text-text-secondary hover:text-text-primary"
            }`}
          >
            模式2：进程数杀
          </button>
          <button
            onClick={async () => { await save({ ...config, agent_mode: 3 }); }}
            className={`flex-1 px-3 py-2 rounded-xl text-md font-medium transition-all duration-150 border ${
              agentMode === 3
                ? "border-accent bg-accent/10 text-accent"
                : "border-border-default text-text-secondary hover:text-text-primary"
            }`}
          >
            模式3：不处理
          </button>
        </div>

        {/* Mode 1: delay slider */}
        {agentMode === 1 && (
          <div className="px-3 py-2 rounded-xl border border-border-default space-y-1.5">
            <span className="text-xs text-text-muted">检测到 Agent 后延迟杀死（秒）</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0} max={1} step={0.1}
                value={agentDelaySecs}
                onChange={async (e) => {
                  await save({ ...config, agent_delay_secs: parseFloat(parseFloat(e.target.value).toFixed(1)) });
                }}
                className="flex-1 h-1 accent-accent"
              />
              <span className="text-md font-mono text-text-primary w-12 text-right">{agentDelaySecs.toFixed(1)}s</span>
            </div>
            <p className="text-2xs text-text-muted">存活期间其他流程正常进行，不阻塞。默认 1.0s，范围 0-1s，最小粒度 0.1s</p>
          </div>
        )}

        {/* Mode 2: threshold selector */}
        {agentMode === 2 && (
          <div className="px-3 py-2 rounded-xl border border-border-default space-y-1.5">
            <span className="text-xs text-text-muted">战网进程数达到阈值时杀死 Agent</span>
            <div className="flex gap-2">
              {[5, 7].map(n => (
                <button
                  key={n}
                  onClick={async () => { await save({ ...config, agent_threshold: n }); }}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-md font-medium transition-all duration-150 border ${
                    agentThreshold === n
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border-default text-text-secondary hover:text-text-primary"
                  }`}
                >
                  ≥ {n}
                </button>
              ))}
            </div>
            <p className="text-2xs text-text-muted">检测到 Agent 后，bnet_count ≥ 阈值时立即杀死。杀一次即停止检测。</p>
          </div>
        )}
      </div>

      <hr className="divider my-2" />

      <span className="text-sm font-medium text-text-muted uppercase tracking-wider block mb-1">功能与动作</span>

      <div onClick={async () => {
          await save({ ...config, auto_close_browser: !config.auto_close_browser });
        }}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-md
          text-text-secondary hover:text-text-primary hover:bg-surface-hover
          transition-all duration-150 text-left cursor-pointer">
        <Globe size={14} className="text-text-muted shrink-0" />
        <div className="flex-1">
          <p className="font-medium">自动关闭隔离浏览器</p>
          <p className="text-xs text-text-muted mt-0.5">流程完成后自动关闭浏览器进程</p>
        </div>
        <div className="shrink-0 mr-1 pointer-events-none">
          <Toggle checked={!!config.auto_close_browser} onChange={() => {}} />
        </div>
      </div>

      <div onClick={async () => {
          await save({ ...config, enable_auto_update: !config.enable_auto_update });
        }}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-md
          text-text-secondary hover:text-text-primary hover:bg-surface-hover
          transition-all duration-150 text-left cursor-pointer">
        <RefreshCw size={14} className="text-text-muted shrink-0" />
        <div className="flex-1">
          <p className="font-medium">自动检查更新</p>
          <p className="text-xs text-text-muted mt-0.5">每日首次启动时检查新版本</p>
        </div>
        <div className="shrink-0 mr-1 pointer-events-none">
          <Toggle checked={!!config.enable_auto_update} onChange={() => {}} />
        </div>
      </div>

      <hr className="divider my-2" />

      <button onClick={onRepairAll}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-md
          text-text-secondary hover:text-text-primary hover:bg-surface-hover
          transition-all duration-150 text-left">
        <RotateCw size={14} className="text-text-muted shrink-0" />
        <div>
          <p className="font-medium">修复全部注册表</p>
          <p className="text-xs text-text-muted mt-0.5">重新导入所有账号的注册表</p>
        </div>
      </button>

      <button onClick={async () => {
          try {
            await invoke("open_logs_dir");
          } catch (e) {
            console.error(e);
          }
        }}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-md
          text-text-secondary hover:text-text-primary hover:bg-surface-hover
          transition-all duration-150 text-left">
        <FolderOpen size={14} className="text-text-muted shrink-0" />
        <div>
          <p className="font-medium">打开日志目录</p>
          <p className="text-xs text-text-muted mt-0.5">查看系统日志文件</p>
        </div>
      </button>

      <button onClick={onReconfigure}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-md
          text-text-secondary hover:text-text-primary hover:bg-surface-hover
          transition-all duration-150 text-left">
        <Settings2 size={14} className="text-text-muted shrink-0" />
        <div>
          <p className="font-medium">重新配置路径</p>
          <p className="text-xs text-text-muted mt-0.5">修改游戏或客户端路径</p>
        </div>
      </button>
    </div>
  );
}
