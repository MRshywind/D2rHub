import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Palette, Settings, Cat, ScanEye, Keyboard } from "lucide-react";
import { useGlobalConfig } from "../../store/globalConfig";
import { useAccounts } from "../../store/accounts";
import { useShortcutRecorder } from "../../hooks/useShortcutRecorder";

import { AppearanceTab } from "./tabs/AppearanceTab";
import { BongoCatTab } from "./tabs/BongoCatTab";
import { OcrTab } from "./tabs/OcrTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { ShortcutsTab } from "./tabs/ShortcutsTab";

interface Props {
  open: boolean;
  onClose: () => void;
  onRepairAll: () => void;
  onReconfigure: () => void;
}

export function ConfigModal({ open, onClose, onRepairAll, onReconfigure }: Props) {
  const { config } = useGlobalConfig();
  const { accounts } = useAccounts();
  const [activeTab, setActiveTab] = useState<"appearance" | "general" | "bongoCat" | "ocr" | "shortcuts">("general");
  const [shortcutBindings, setShortcutBindings] = useState<Record<string, string>>(() => {
    try {
      return config?.shortcut_bindings_json ? JSON.parse(config.shortcut_bindings_json) : {};
    } catch { return {}; }
  });
  const { recordingPos, setRecordingPos } = useShortcutRecorder();

  return (
    <Modal open={open} onClose={onClose} title="设置" width="max-w-xl">
      <div className="flex gap-4 min-h-[360px]">
        {/* Left Navigation Tabs */}
        <div className="w-[130px] shrink-0 flex flex-col gap-1 border-r border-border-default pr-3">
          <button
            onClick={() => setActiveTab("general")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-md font-semibold transition-all duration-150 ${
              activeTab === "general"
                ? "bg-surface-hover text-accent font-bold"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover/50"
            }`}
          >
            <Settings size={14} className="shrink-0" />
            <span>通用设置</span>
          </button>
          <button
            onClick={() => setActiveTab("appearance")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-md font-semibold transition-all duration-150 ${
              activeTab === "appearance"
                ? "bg-surface-hover text-accent font-bold"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover/50"
            }`}
          >
            <Palette size={14} className="shrink-0" />
            <span>外观设置</span>
          </button>
          <button
            onClick={() => setActiveTab("bongoCat")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-md font-semibold transition-all duration-150 ${
              activeTab === "bongoCat"
                ? "bg-surface-hover text-accent font-bold"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover/50"
            }`}
          >
            <Cat size={14} className="shrink-0" />
            <span>猫咪设置</span>
          </button>
          {import.meta.env.VITE_ENABLE_OCR !== "false" && (
            <button
              onClick={() => setActiveTab("ocr")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-md font-semibold transition-all duration-150 ${
                activeTab === "ocr"
                  ? "bg-surface-hover text-accent font-bold"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover/50"
              }`}
            >
              <ScanEye size={14} className="shrink-0" />
              <span>自动识别</span>
            </button>
          )}
          <button
            onClick={() => setActiveTab("shortcuts")}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-md font-semibold transition-all duration-150 ${
              activeTab === "shortcuts"
                ? "bg-surface-hover text-accent font-bold"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover/50"
            }`}
          >
            <Keyboard size={14} className="shrink-0" />
            <span>快捷键</span>
          </button>
        </div>

        {/* Right Content Panel */}
        <div className="flex-1 pl-1 space-y-4 max-h-[437px] overflow-y-auto pr-1">
          {activeTab === "appearance" && <AppearanceTab />}
          {activeTab === "bongoCat" && <BongoCatTab />}
          {import.meta.env.VITE_ENABLE_OCR !== "false" && activeTab === "ocr" && config && <OcrTab />}
          {activeTab === "general" && (
            <GeneralTab onRepairAll={onRepairAll} onReconfigure={onReconfigure} />
          )}
          {activeTab === "shortcuts" && config && (
            <ShortcutsTab
              accounts={accounts}
              shortcutBindings={shortcutBindings}
              recordingPos={recordingPos}
              setRecordingPos={setRecordingPos}
              onSave={async (bindings) => {
                setShortcutBindings(bindings);
                const { useGlobalConfig } = await import("../../store/globalConfig");
                const { save } = useGlobalConfig.getState();
                await save({ ...config, shortcut_bindings_json: JSON.stringify(bindings) });
              }}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
