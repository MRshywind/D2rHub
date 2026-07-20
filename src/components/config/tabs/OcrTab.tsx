import { ScanEye, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useGlobalConfig } from "../../../store/globalConfig";
import { useAccounts } from "../../../store/accounts";
import { showToast } from "../../ui/Toast";
import { Toggle } from "../../ui/Toggle";

export function OcrTab() {
  const { config, save } = useGlobalConfig();
  const { accounts } = useAccounts();

  if (!config) return null;

  return (
    <div className="space-y-4">
      <span className="text-sm font-medium text-text-muted uppercase tracking-wider block mb-1">自动文字识别 (OCR)</span>

      {/* Enable toggle */}
      <div
        onClick={async () => {
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
          <Toggle checked={config.ocr_enabled} onChange={() => {}} />
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
          value={config.ocr_target_account}
          onChange={async (e) => {
            await save({ ...config, ocr_target_account: e.target.value });
          }}
          className="w-full h-8 px-2.5 rounded-lg text-md text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/40"
          style={{ background: 'var(--surface-base)', border: '1px solid var(--border-default)' }}
        >
          <option value="">-- 选择账号 --</option>
          {accounts.filter(a => a.initialized).map(a => (
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

      {/* Restart OCR */}
      <button onClick={async () => {
          try {
            await invoke("stop_ocr_monitor").catch(()=>{});
            const targetAccount = accounts.find(a => a.id === config.ocr_target_account);
            const winTitle = targetAccount?.display_name || config.ocr_target_account || "";
            const targetPid = targetAccount?.running_pid ?? null;
            await invoke("start_ocr_monitor", { config: {
              window_title: winTitle,
              target_pid: targetPid,
              poll_interval_ms: config.ocr_poll_interval_ms ?? 500,
              debug_output: config.ocr_debug_output ?? false,
            }});
            showToast("success", "OCR 已用新配置重启");
          } catch(e) { showToast("error","重启OCR失败: "+e); }
        }}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-md text-accent hover:bg-accent/10 transition-all duration-150 text-left">
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
