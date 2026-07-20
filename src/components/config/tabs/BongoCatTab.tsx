import { MessageSquare, Cat, Lock } from "lucide-react";
import { useGlobalConfig } from "../../../store/globalConfig";
import { Toggle } from "../../ui/Toggle";

export function BongoCatTab() {
  const { config, save } = useGlobalConfig();

  if (!config) return null;

  const handleScaleChange = async (newVal: number) => {
    await save({ ...config, bongo_cat_scale: newVal });
  };

  const toggleBongoCat = async () => {
    const newValue = !config.enable_bongo_cat;
    await save({ ...config, enable_bongo_cat: newValue });

    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const catWin = await WebviewWindow.getByLabel('bongo-cat');
      if (catWin) {
        if (newValue) {
          await catWin.show();
        } else {
          await catWin.hide();
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleChatterbox = async () => {
    const newValue = !config.bongo_cat_chatterbox;
    await save({ ...config, bongo_cat_chatterbox: newValue });
  };

  return (
    <div className="space-y-4">
      {/* Toggles */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-text-muted uppercase tracking-wider block mb-1">悬浮窗与功能开关</span>

        <div onClick={toggleBongoCat}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-md
            text-text-secondary hover:text-text-primary hover:bg-surface-hover
            transition-all duration-150 text-left cursor-pointer">
          <Cat size={14} className="text-text-muted shrink-0" />
          <div className="flex-1">
            <p className="font-medium">猫咪悬浮窗</p>
            <p className="text-xs text-text-muted mt-0.5">桌面上显示可拖动的打鼓猫咪</p>
          </div>
          <div className="shrink-0 mr-1 pointer-events-none">
            <Toggle checked={config.enable_bongo_cat} onChange={() => {}} />
          </div>
        </div>

        <div onClick={toggleChatterbox}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-md
            text-text-secondary hover:text-text-primary hover:bg-surface-hover
            transition-all duration-150 text-left cursor-pointer">
          <MessageSquare size={14} className="text-text-muted shrink-0" />
          <div className="flex-1">
            <p className="font-medium">猫咪话痨模式</p>
            <p className="text-xs text-text-muted mt-0.5">开启后敲击键盘或鼠标会随机触发吐槽气泡</p>
          </div>
          <div className="shrink-0 mr-1 pointer-events-none">
            <Toggle checked={config.bongo_cat_chatterbox} onChange={() => {}} />
          </div>
        </div>
      </div>

      {/* Skin Selection */}
      <div>
        <span className="text-sm font-medium text-text-muted uppercase tracking-wider">猫咪悬浮窗皮肤</span>
        <div className="grid grid-cols-2 gap-2.5 mt-2">
          <button
            onClick={() => save({ ...config, bongo_cat_skin: "original" })}
            className={`flex items-center justify-between px-3 py-2 rounded-xl text-md font-medium transition-all duration-200 active:scale-[0.97] border ${
              config.bongo_cat_skin === "original"
                ? "bg-surface-hover border-border-strong text-text-primary"
                : "bg-transparent border-border-default text-text-secondary"
            }`}
          >
            <div className="text-left">
              <p className="font-semibold">原版猫咪</p>
              <p className="text-xs text-text-muted mt-0.5">经典白猫打碟</p>
            </div>
          </button>

          <button
            onClick={() => {
              if (config.bongo_cat_unlocked_skins.includes("mage")) {
                save({ ...config, bongo_cat_skin: "mage" });
              }
            }}
            disabled={!config.bongo_cat_unlocked_skins.includes("mage")}
            title={!config.bongo_cat_unlocked_skins.includes("mage") ? "暂未获取，快让猫猫敲击的更多来抽奖吧！" : undefined}
            className={`flex items-center justify-between px-3 py-2 rounded-xl text-md font-medium transition-all duration-200 active:scale-[0.97] border ${
              config.bongo_cat_skin === "mage"
                ? "bg-surface-hover border-border-strong text-text-primary"
                : config.bongo_cat_unlocked_skins.includes("mage")
                ? "bg-transparent border-border-default text-text-secondary"
                : "bg-transparent border-dashed border-border-default text-text-muted cursor-not-allowed opacity-60"
            }`}
          >
            <div className="text-left">
              <p className="font-semibold">法师猫咪</p>
              <p className="text-xs text-text-muted mt-0.5">暗黑2宝石头环</p>
            </div>
            {!config.bongo_cat_unlocked_skins.includes("mage") && <Lock size={12} className="text-text-muted ml-2 shrink-0" />}
          </button>
        </div>
      </div>

      {/* Scale Slider */}
      <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-text-muted uppercase tracking-wider">猫咪缩放比例</span>
            <span className="text-sm font-mono text-accent font-semibold">{config.bongo_cat_scale.toFixed(1)}x</span>
          </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0.5"
            max="5.0"
            step="0.1"
            value={config.bongo_cat_scale}
            onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
            className="flex-1 accent-accent h-1 bg-surface-hover rounded-lg appearance-none cursor-pointer"
          />
          <button
            onClick={() => handleScaleChange(1.0)}
            className="px-2 py-0.5 rounded bg-surface-hover hover:bg-surface-hover/80 text-xs text-text-secondary transition-all"
          >
            重置
          </button>
        </div>
      </div>
    </div>
  );
}
