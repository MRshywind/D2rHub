import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type ThemeKey } from "../../../store/theme";
import { useGlobalConfig } from "../../../store/globalConfig";
import { Toggle } from "../../ui/Toggle";

const themes: { id: ThemeKey; label: string; icon: typeof Moon; desc: string }[] = [
  { id: "onyx",  label: "深色",  icon: Moon,  desc: "暗黑风格" },
  { id: "light", label: "浅色",  icon: Sun,   desc: "清爽明亮" },
];

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { config, save } = useGlobalConfig();

  return (
    <div className="space-y-4">
      {/* Theme section */}
      <div>
        <span className="text-sm font-medium text-text-muted uppercase tracking-wider">外观 (主界面)</span>
        <div className="grid grid-cols-2 gap-2.5 mt-2">
          {themes.map(t => {
            const active = theme === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTheme(t.id)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-md font-medium
                  transition-all duration-200 active:scale-[0.97]"
                style={{
                  background: active ? "var(--surface-hover)" : "transparent",
                  border: active ? "1px solid var(--border-strong)" : "1px solid var(--border-default)",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                }}>
                <Icon size={16} className={active ? "text-accent" : ""} />
                <div className="text-left">
                  <p className="font-semibold">{t.label}</p>
                  <p className="text-xs text-text-muted mt-0.5">{t.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Overlay Theme section */}
      <div>
        <span className="text-sm font-medium text-text-muted uppercase tracking-wider">外观 (性能悬浮窗)</span>
        <div className="grid grid-cols-2 gap-2.5 mt-2">
          {themes.map(t => {
            const currentOverlayTheme = config?.theme_overlay || "light";
            const active = currentOverlayTheme === t.id;
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={async () => {
                if (config) {
                  localStorage.setItem("d2rhub-theme-overlay", t.id);
                  await save({ ...config, theme_overlay: t.id as ThemeKey });
                }
              }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-md font-medium
                  transition-all duration-200 active:scale-[0.97]"
                style={{
                  background: active ? "var(--surface-hover)" : "transparent",
                  border: active ? "1px solid var(--border-strong)" : "1px solid var(--border-default)",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                }}>
                <Icon size={16} className={active ? "text-accent" : ""} />
                <div className="text-left">
                  <p className="font-semibold">{t.label}</p>
                  <p className="text-xs text-text-muted mt-0.5">{t.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 透明度设置 */}
      <div className="space-y-3 pt-2 border-t border-border-default">
        <span className="text-sm font-medium text-text-muted uppercase tracking-wider block">窗口透明度</span>

        {/* 悬浮窗透明度 */}
        <div className="space-y-0.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-text-muted font-medium">悬浮窗透明度</span>
            <span className="text-xs font-mono text-accent font-semibold">{config?.overlay_opacity ?? 95}%</span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="1"
            value={config?.overlay_opacity ?? 95}
            onChange={async (e) => {
              const v = parseInt(e.target.value) || 95;
              if (config) await save({ ...config, overlay_opacity: v });
            }}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-hover
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:shadow-glow [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150
              [&::-webkit-slider-thumb]:hover:scale-110"
          />
        </div>

        {/* 主界面透明度 */}
        <div className="space-y-0.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-text-muted font-medium">主界面透明度</span>
            <span className="text-xs font-mono text-accent font-semibold">{config?.main_opacity ?? 95}%</span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="1"
            value={config?.main_opacity ?? 95}
            onChange={async (e) => {
              const v = parseInt(e.target.value) || 95;
              if (config) await save({ ...config, main_opacity: v });
            }}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-surface-hover
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:shadow-glow [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150
              [&::-webkit-slider-thumb]:hover:scale-110"
          />
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-border-default">
        <span className="text-sm font-medium text-text-muted uppercase tracking-wider block mb-1">悬浮窗显示</span>

        <div onClick={async () => {
            if (config) {
              const newValue = !config.enable_overlay;
              await save({ ...config, enable_overlay: newValue });
              try {
                const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
                const overlayWin = await WebviewWindow.getByLabel('overlay');
                if (overlayWin) {
                  if (newValue) {
                    await overlayWin.show();
                  } else {
                    await overlayWin.hide();
                  }
                }
              } catch (e) {
                console.error(e);
              }
            }
          }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-md
            text-text-secondary hover:text-text-primary hover:bg-surface-hover
            transition-all duration-150 text-left cursor-pointer">
          <Monitor size={14} className="text-text-muted shrink-0" />
          <div className="flex-1">
            <p className="font-medium">性能悬浮窗</p>
            <p className="text-xs text-text-muted mt-0.5">开启后在桌面上常驻显示系统性能信息</p>
          </div>
          <div className="shrink-0 mr-1 pointer-events-none">
            <Toggle checked={!!config?.enable_overlay} onChange={() => {}} />
          </div>
        </div>
      </div>
    </div>
  );
}
