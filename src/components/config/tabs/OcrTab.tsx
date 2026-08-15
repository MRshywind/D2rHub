import { ScanEye, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useGlobalConfig } from "../../../store/globalConfig";
import { useAccounts } from "../../../store/accounts";
import { showToast } from "../../ui/Toast";
import { Toggle } from "../../ui/Toggle";
import { validateOcrTarget } from "../../../utils/ocrTarget";

export function OcrTab() {
  const { config, save } = useGlobalConfig();
  const { accounts } = useAccounts();

  if (!config) return null;

  const initializedAccounts = accounts.filter((account) => account.initialized);
  const ocrTarget = validateOcrTarget(config.ocr_target_account, accounts);

  return (
    <div className="space-y-4">
      <span className="text-sm font-medium text-text-muted uppercase tracking-wider block mb-1">自动文字识别 (OCR)</span>

      {/* Enable toggle */}
      <div
        onClick={async () => {
          if (!config.ocr_enabled && !ocrTarget.valid) {
            showToast("warning", "请先选择 OCR 目标账号");
            return;
          }
          await save({ ...config, ocr_enabled: !config.ocr_enabled });
        }}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-md
          transition-all duration-150 text-left cursor-pointer"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ScanEye size={14} className="text-text-muted shrink-0" />
        <div className="flex-1">
          <p className="font-medium">启用自动识别</p>
          <p className="text-xs text-text-muted mt-0.5">游戏启动后自动开始 OCR 文字识别</p>
        </div>
        <div className="shrink-0 mr-1 pointer-events-none">
          <Toggle
            checked={config.ocr_enabled && ocrTarget.valid}
            disabled={!ocrTarget.valid}
            ariaLabel="启用自动文字识别"
            onChange={() => {}}
          />
        </div>
      </div>

      {/* Debug toggle */}
      <div
        onClick={async () => {
          await save({ ...config, ocr_debug_output: !config.ocr_debug_output });
        }}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-md
          transition-all duration-150 text-left cursor-pointer"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ScanEye size={14} className="text-text-muted shrink-0" />
        <div className="flex-1">
          <p className="font-medium">调试输出并保存中间截图</p>
          <p className="text-xs text-text-muted mt-0.5">保存通道 A/B 黑白处理图和 OCR 日志文本至 config/test 目录</p>
        </div>
        <div className="shrink-0 mr-1 pointer-events-none">
          <Toggle checked={!!config.ocr_debug_output} onChange={() => {}} />
        </div>
      </div>

      {/* Target account picker */}
      <div className="space-y-1.5">
        <span className="text-xs text-text-muted font-medium">识别对象（游戏窗口）</span>
        <select
          value={ocrTarget.valid ? ocrTarget.account.id : ""}
          disabled={initializedAccounts.length === 0}
          onChange={async (e) => {
            await save({ ...config, ocr_target_account: e.target.value });
          }}
          className="w-full h-8 px-2.5 rounded-lg text-md text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
          style={{ background: 'var(--surface-base)', border: '1px solid var(--border-default)' }}
        >
          <option value="" disabled>{initializedAccounts.length === 0 ? "-- 暂无可用账号 --" : "-- 选择账号 --"}</option>
          {initializedAccounts.map(a => (
            <option key={a.id} value={a.id}>{a.display_name || a.id} ({a.id})</option>
          ))}
        </select>
      </div>

      {/* Polling Interval */}
      <div className="space-y-1.5" title="若设备性能不足可降低为 1Hz，识别准确率可能下降">
        <span className="text-xs text-text-muted font-medium">识别频率 (重启OCR生效)</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={config.ocr_poll_interval_ms ?? 500}
            min={200} max={5000} step={100}
            onChange={async (e) => {
              const v = Math.max(200, Math.min(5000, parseInt(e.target.value) || 500));
              await save({ ...config, ocr_poll_interval_ms: v });
            }}
            className="w-20 h-7 px-1.5 rounded-md text-sm text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-accent/40"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--border-default)' }}
          />
          <span className="text-2xs text-text-muted">
            ms · {1000 / (config.ocr_poll_interval_ms || 500)}Hz · 设备性能不足可降低频率
          </span>
        </div>
      </div>

      {/* 计时模式 */}
      <div className="space-y-1.5">
        <span className="text-xs text-text-muted font-medium">计时模式</span>
        <select
          value={config.ocr_timing_mode || "full_clear"}
          onChange={async (e) => {
            await save({ ...config, ocr_timing_mode: e.target.value });
          }}
          className="w-full h-8 px-2.5 rounded-lg text-md text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
          style={{ background: 'var(--surface-base)', border: '1px solid var(--border-default)' }}
        >
          <option value="full_clear">通刷模式 — 每个场景独立计时</option>
          <option value="single_scene">单场景模式 — 主城出发到回城算一轮</option>
          <option value="start_middle_end">阶段标记 — 自定义开始/目标/结束</option>
        </select>
      </div>

      {/* 切屏自动暂停 */}
      <div
        onClick={async () => {
          await save({ ...config, ocr_auto_pause_on_switch: !config.ocr_auto_pause_on_switch });
        }}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-md
          transition-all duration-150 text-left cursor-pointer"
        style={{ color: 'var(--text-secondary)' }}
      >
        <div className="flex-1">
          <p className="font-medium">切屏自动暂停</p>
          <p className="text-xs text-text-muted mt-0.5">切换到其他窗口时自动暂停计时，切回游戏自动恢复</p>
        </div>
        <div className="shrink-0 mr-1 pointer-events-none">
          <Toggle checked={!!config.ocr_auto_pause_on_switch} onChange={() => {}} />
        </div>
      </div>

      {/* 快捷键提示 */}
      <div className="px-1 text-xs text-text-muted space-y-0.5">
        <p>快捷键：<kbd className="px-1 py-0.5 rounded bg-surface/50 text-[10px] font-mono">Ctrl+Shift+P</kbd> 暂停/恢复计时</p>
        <p>按 <kbd className="px-1 py-0.5 rounded bg-surface/50 text-[10px] font-mono">ESC</kbd> 退出到主界面时自动结束本轮计时</p>
      </div>

      {/* Restart OCR */}
      <button disabled={!config.ocr_enabled || !ocrTarget.valid} onClick={async () => {
          try {
            await save(config);
            await invoke("restart_ocr_monitor");
            showToast("success", "OCR 已用新配置重启");
          } catch(e) { showToast("error","重启OCR失败: "+e); }
        }}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-md text-accent hover:bg-accent/10 transition-all duration-150 text-left disabled:opacity-50 disabled:cursor-not-allowed">
        <RefreshCw size={13} className="shrink-0" />
        <div>
          <p className="font-medium">应用配置并重启 OCR</p>
          <p className="text-xs text-text-muted mt-0.5">使用当前配置重新启动 OCR 扫描</p>
        </div>
      </button>

      {/* Open Stats */}
      <button onClick={async () => {
          try {
            await invoke("open_stats_page");
          } catch (e) { showToast("error", "打开统计失败: " + e); }
        }}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-all duration-150 text-left">
        <div>
          <p className="font-medium">查看数据统计</p>
          <p className="text-xs text-text-muted mt-0.5">打开浏览器查看刷图效率与符文统计</p>
        </div>
      </button>
    </div>
  );
}
