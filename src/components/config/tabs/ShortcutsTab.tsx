import { parseShortcutFromKeyEvent } from "../../../hooks/useShortcutRecorder";

export function ShortcutsTab({
  accounts,
  shortcutBindings,
  recordingPos,
  setRecordingPos,
  onSave,
}: {
  accounts: import("../../../store/types").AccountMeta[];
  shortcutBindings: Record<string, string>;
  recordingPos: string | null;
  setRecordingPos: (pos: string | null) => void;
  onSave: (bindings: Record<string, string>) => Promise<void>;
}) {
  const initialized = accounts.filter(a => a.initialized).sort((a, b) => (a.order || 0) - (b.order || 0));

  const getShortcut = (pos: string): string => {
    return shortcutBindings[pos] || "";
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, pos: string) => {
    e.preventDefault();
    e.stopPropagation();

    const combo = parseShortcutFromKeyEvent(e);
    if (!combo) return;

    const newBindings = { ...shortcutBindings, [pos]: combo };
    onSave(newBindings);
    setRecordingPos(null);
    (e.target as HTMLInputElement).blur();
  };

  const handleClear = (pos: string) => {
    const newBindings = { ...shortcutBindings };
    delete newBindings[pos];
    onSave(newBindings);
  };

  const handleFocus = (pos: string) => {
    setRecordingPos(pos);
  };

  const handleBlur = () => {
    setTimeout(() => setRecordingPos(null), 200);
  };

  if (initialized.length === 0) {
    return (
      <div className="space-y-4">
        <span className="text-sm font-medium text-text-muted uppercase tracking-wider block mb-1">快捷键</span>
        <p className="text-md text-text-muted italic">暂无已初始化的账号，请先添加并初始化账号</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <span className="text-sm font-medium text-text-muted uppercase tracking-wider block mb-1">快捷键</span>
        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
          配置全局快捷键，按下后自动将对应账号的游戏窗口置顶。支持 Ctrl/Alt/Shift 组合键或单键。
        </p>
      </div>

      <div className="space-y-1.5">
        {initialized.map((account, index) => {
          const pos = String(index + 1);
          const shortcut = getShortcut(pos);
          const isRecording = recordingPos === pos;

          return (
            <div
              key={account.id}
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-md transition-all duration-150"
              style={{ background: "var(--surface-base)", border: "1px solid var(--border-default)" }}
            >
              <span className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold shrink-0"
                style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>
                {pos}
              </span>

              <span className="flex-1 text-text-primary font-medium truncate">
                {account.display_name || account.id}
              </span>

              <div className="flex items-center gap-1 shrink-0">
                <input
                  className={`h-7 px-2.5 rounded-lg text-sm font-mono text-center outline-none transition-all duration-150
                    ${isRecording ? "ring-1 ring-accent" : ""}`}
                  style={{
                    width: isRecording ? 120 : 100,
                    background: isRecording ? "rgb(var(--accent-rgb) / 0.08)" : "var(--surface-hover)",
                    border: isRecording ? "1px solid var(--accent)" : "1px solid transparent",
                    color: shortcut ? "var(--text-primary)" : "var(--text-muted)",
                    cursor: "pointer",
                  }}
                  value={isRecording ? "按下按键..." : shortcut || "未设置"}
                  readOnly
                  onFocus={() => handleFocus(pos)}
                  onBlur={handleBlur}
                  onKeyDown={(e) => handleInputKeyDown(e, pos)}
                  title={isRecording ? "请按下快捷键组合..." : shortcut ? `当前: ${shortcut}\n点击修改` : "点击设置快捷键"}
                />
                {shortcut && (
                  <button
                    onClick={() => handleClear(pos)}
                    className="w-5 h-5 rounded flex items-center justify-center text-xs text-text-muted hover:text-error hover:bg-error/10 transition-all"
                    title="清除快捷键"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-2xs text-text-muted leading-relaxed">
        💡 提示：默认 Ctrl+1/2/3 对应前三个账号。点击输入框后按下目标快捷键即可录制。支持单键（如 F5）或组合键（如 Ctrl+Shift+A）。
      </p>
    </div>
  );
}
