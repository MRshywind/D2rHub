import React, { useEffect, useState } from "react";
import { FolderOpen, Check, HardDrive, Save, Search, ArrowRight, Wrench, AlertTriangle, Globe } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useGlobalConfig } from "../store/globalConfig";
import { showToast } from "../components/ui/Toast";
import type { GlobalConfig } from "../store/types";

interface Props { onComplete: () => void; initialConfig?: GlobalConfig; }

const defaultConfig: GlobalConfig = {
  version: 1, battle_net_path: "", game_path: "", saved_games_path: "",
  program_data_agent_path: "", app_data_roaming_bnet_path: "",
  accounts_dir: "", first_run_complete: false,
  browser_path: "", browser_type: "", enable_overlay: true,
  theme: "light", theme_overlay: "light", auto_close_browser: true,
  enable_auto_update: true, first_launch: true,
  ocr_enabled: false, ocr_target_account: "",
  ocr_ch_b_profiles_json: "",
  shortcut_bindings_json: "",
  overlay_opacity: 95, main_opacity: 95, font_scale: "default",
  enable_bongo_cat: true, bongo_cat_chatterbox: true,
  bongo_cat_scale: 1.0, bongo_cat_skin: "original",
  bongo_cat_unlocked_skins: ["original"],
};

export function SetupWizard({ onComplete, initialConfig }: Props) {
  const { save, detectBattleNetPath, detectSavedGamesPath, detectProgramDataAgentPath, detectAppDataRoamingBnetPath, detectBrowserPath } = useGlobalConfig();
  const [config, setConfig] = useState<GlobalConfig>(initialConfig || defaultConfig);
  const [detected, setDetected] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showError, setShowError] = useState(false);
  const [isCurrentStepValid, setIsCurrentStepValid] = useState(false);
  const [settingsJsonAvailable, setSettingsJsonAvailable] = useState<boolean | null>(null);

  const handleSelectBrowser = async (btype: "chrome" | "edge") => {
    try {
      const path = await invoke<string | null>("detect_browser_path_by_type", { browserType: btype });
      if (path) {
        setConfig(c => ({ ...c, browser_path: path, browser_type: btype }));
        showToast("success", `自动检测并选择 ${btype === "edge" ? "Microsoft Edge" : "Google Chrome"} 成功`);
      } else {
        showToast("warning", `未检测到 ${btype === "edge" ? "Microsoft Edge" : "Google Chrome"} 的默认路径，请手动选择`);
        const sel = await open({
          multiple: false,
          filters: [{ name: btype === "edge" ? "msedge.exe" : "chrome.exe", extensions: ["exe"] }]
        });
        if (sel) {
          setConfig(c => ({ ...c, browser_path: sel as string, browser_type: btype }));
          showToast("success", `手动选择 ${btype === "edge" ? "Microsoft Edge" : "Google Chrome"} 成功`);
        }
      }
    } catch (e) {
      showToast("error", `检测或选择浏览器失败: ${e}`);
    }
  };

  useEffect(() => {
    (async () => {
      const bnet = await detectBattleNetPath();
      const savedGames = await detectSavedGamesPath();
      const agent = await detectProgramDataAgentPath();
      const roaming = await detectAppDataRoamingBnetPath();
      const browser = await detectBrowserPath();
      setDetected({
        bnet, savedGames, agent, roaming,
        browser: browser ? browser[0] : null,
      });
      setConfig(p => ({
        ...p,
        battle_net_path: p.battle_net_path || bnet || "",
        saved_games_path: p.saved_games_path || savedGames || "",
        program_data_agent_path: p.program_data_agent_path || agent || "C:\\ProgramData\\Battle.net\\Agent",
        app_data_roaming_bnet_path: p.app_data_roaming_bnet_path || roaming || "",
        browser_path: p.browser_path || (browser ? browser[0] : ""),
        browser_type: p.browser_type || (browser ? browser[1] : ""),
      }));
    })();
  }, []);

  const allStepsFilled = () => {
    if (!config.battle_net_path) return false;
    if (!config.game_path) return false;
    if (!config.saved_games_path) return false;
    return true;
  };

  const getMissingSteps = () => {
    const missing: string[] = [];
    if (!config.battle_net_path) missing.push(stepLabels[0]);
    if (!config.game_path) missing.push(stepLabels[1]);
    if (!config.saved_games_path) missing.push(stepLabels[2]);
    return missing;
  };

  const handleComplete = async () => {
    if (!allStepsFilled()) {
      setShowError(true);
      return;
    }
    setSaving(true);
    try {
      await save({ ...config, first_run_complete: true, first_launch: false,
        program_data_agent_path: config.program_data_agent_path || "C:\\ProgramData\\Battle.net\\Agent" });
      onComplete();
    } catch (e) {
      showToast("error", `保存配置失败: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const stepLabels = ["战网客户端路径", "游戏安装目录", "存档目录", "浏览器"];

  const steps = [
    { key: "battle_net_path" as const, title: "战网客户端", desc: "选择 Battle.net.exe 的路径",
      icon: <HardDrive size={20} />,
      placeholder: "浏览选择 Battle.net.exe", isFile: true,
      value: config.battle_net_path, setValue: (v:string)=>setConfig(c=>({...c,battle_net_path:v})), detected: detected.bnet },
    { key: "game_path" as const, title: "游戏安装目录", desc: "选择 D2R 的安装位置",
      icon: <FolderOpen size={20} />,
      placeholder: "浏览选择游戏安装目录", isFile: false,
      value: config.game_path, setValue: (v:string)=>setConfig(c=>({...c,game_path:v})), detected: null },
    { key: "saved_games_path" as const, title: "存档目录", desc: "通常位于 Saved Games 文件夹",
      icon: <Save size={20} />,
      placeholder: "浏览选择 Saved Games 目录", isFile: false,
      value: config.saved_games_path, setValue: (v:string)=>setConfig(c=>({...c,saved_games_path:v})), detected: detected.savedGames },
    { key: "browser_path" as const, title: "浏览器", desc: "用于多账号浏览器隔离（可选，仅支持 Chrome/Edge）",
      icon: <Globe size={20} />,
      placeholder: "浏览选择浏览器路径（可选）", isFile: true,
      value: config.browser_path,
      setValue: (v:string)=>{
        setConfig(c=>{
          // Auto-detect browser type from path
          const lower = v.toLowerCase();
          let btype = c.browser_type;
          if (lower.includes("msedge") || lower.includes("edge")) btype = "edge";
          else if (lower.includes("chrome")) btype = "chrome";
          return {...c, browser_path: v, browser_type: btype};
        });
      },
      detected: detected.browser },
  ];

  useEffect(() => {
    let active = true;
    if (!config.saved_games_path) {
      setSettingsJsonAvailable(null);
      return () => {
        active = false;
      };
    }
    invoke<boolean>("check_saved_games_settings", { path: config.saved_games_path })
      .then((exists) => {
        if (active) setSettingsJsonAvailable(exists);
      })
      .catch(() => {
        if (active) setSettingsJsonAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [config.saved_games_path]);

  useEffect(() => {
    let active = true;
    const checkStepValidity = async () => {
      const step = steps[currentStep];
      if (!step) return;

      // browser_path is optional. If empty, it's valid.
      if (step.key === "browser_path" && !step.value) {
        if (active) setIsCurrentStepValid(true);
        return;
      }

      if (!step.value) {
        if (active) setIsCurrentStepValid(false);
        return;
      }

      if (step.key === "saved_games_path") {
        if (active) setIsCurrentStepValid(true);
        return;
      }

      try {
        const exists = await invoke<boolean>("check_path_exists", {
          path: step.value,
          isFile: step.isFile,
        });
        if (active) setIsCurrentStepValid(exists);
      } catch (e) {
        if (active) setIsCurrentStepValid(false);
      }
    };

    checkStepValidity();
    return () => {
      active = false;
    };
  }, [currentStep, config.battle_net_path, config.game_path, config.saved_games_path, config.browser_path]);

  const current = steps[currentStep];

  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="w-[520px] account-line px-6 py-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="swiss-mark shrink-0">
            <Wrench size={16} className="text-text-secondary" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">{initialConfig ? "重新配置" : "初始设置"}</p>
            <p className="micro-meta mt-1">{initialConfig ? "修改路径后保存即可生效" : "配置游戏路径，只需一次"}</p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mb-5">
          {steps.map((s, i) => (
            <React.Fragment key={i}>
              <button onClick={()=>setCurrentStep(i)}
                className="w-8 h-8 rounded-[12px] flex items-center justify-center text-xs font-semibold
                  transition-all duration-200 ease-out active:scale-[0.97]"
                style={i === currentStep
                  ? { background: "var(--cta-bg, var(--accent))", color: "var(--cta-text, #fff)" }
                  : s.value
                    ? { background: "rgba(52,199,89,0.10)", color: "var(--success)", border: "1px solid rgba(52,199,89,0.16)" }
                    : { background: "var(--surface-hover)", color: "var(--text-muted)", border: "1px solid var(--border-default)" }
                }>{s.value ? <Check size={13} /> : i+1}</button>
              {i<steps.length-1 && (
                <div className="w-7 h-px" style={{ background: s.value ? "rgba(52,199,89,0.20)" : "var(--border-default)" }}/>
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="rounded-card p-4 mb-4"
          style={{ background: "var(--surface-tile-soft, var(--surface-card))", border: "1px solid var(--border-default)" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-[14px] flex items-center justify-center"
              style={{ background: "var(--surface-hover)", border: "1px solid var(--border-default)" }}>
              <span className="text-text-secondary">{current.icon}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">{current.title}</p>
              <p className="micro-meta mt-1">{current.desc}</p>
            </div>
          </div>

          {current.key === "browser_path" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleSelectBrowser("chrome")}
                  className="flex flex-col items-center justify-center p-4 rounded-card transition-all duration-200 ease-out active:scale-[0.97]"
                  style={{
                    background: config.browser_type === "chrome" ? "rgb(var(--accent-rgb) / 0.08)" : "var(--surface-hover)",
                    border: config.browser_type === "chrome" ? "1px solid rgb(var(--accent-rgb) / 0.22)" : "1px solid var(--border-default)",
                  }}
                >
                  <Globe size={18} className="mb-2 text-text-secondary" />
                  <span className="text-xs font-semibold text-text-primary">Google Chrome</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectBrowser("edge")}
                  className="flex flex-col items-center justify-center p-4 rounded-card transition-all duration-200 ease-out active:scale-[0.97]"
                  style={{
                    background: config.browser_type === "edge" ? "rgb(var(--accent-rgb) / 0.08)" : "var(--surface-hover)",
                    border: config.browser_type === "edge" ? "1px solid rgb(var(--accent-rgb) / 0.22)" : "1px solid var(--border-default)",
                  }}
                >
                  <Globe size={18} className="mb-2 text-text-secondary" />
                  <span className="text-xs font-semibold text-text-primary">Microsoft Edge</span>
                </button>
              </div>

              {config.browser_path && (
                <div className="p-3 rounded-card text-xs font-mono break-all leading-relaxed text-text-secondary"
                  style={{ background: "var(--surface-hover)", border: "1px solid var(--border-default)" }}>
                  <p className="micro-meta mb-1">浏览器路径</p>
                  {config.browser_path}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                className="line-input flex-1 h-9 px-3.5 text-md font-mono placeholder:text-text-muted/40"
                value={current.value} onChange={e=>current.setValue(e.target.value)}
                placeholder={current.placeholder}
              />
              <button onClick={async ()=>{
                try {
                  if(current.isFile){ const sel=await open({multiple:false,filters:[{name:"可执行文件",extensions:["exe"]}]}); if(sel)current.setValue(sel as string); }
                  else { const sel=await open({directory:true,multiple:false}); if(sel)current.setValue(sel as string); }
                }catch(e){showToast("error",`选择失败:${e}`);}
              }}
                className="icon-btn h-9 w-9 shrink-0"
                style={{ border: "1px solid var(--border-default)" }}>
                <Search size={15}/>
              </button>
            </div>
          )}

          {current.detected && current.key !== "browser_path" && (
            <p className="text-sm text-success mt-3 flex items-center gap-1.5">
              <Check size={11}/> 已自动检测到
            </p>
          )}

          {current.key === "saved_games_path" && settingsJsonAvailable === false && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-card mt-3"
              style={{ background: "var(--toast-warning-bg)", border: "1px solid var(--toast-warning-border)" }}>
              <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-text-secondary leading-relaxed">
                当前目录中未找到 Settings.json。账号创建、登录和多开不受影响，但画质配置相关功能暂不可用。请先启动一次游戏生成该文件，或稍后在设置中修正存档目录。
              </p>
            </div>
          )}

          {current.key === "browser_path" && (
            <p className="text-xs text-text-muted mt-3">
              不配置浏览器不影响核心功能，仅影响多账号浏览器隔离
            </p>
          )}
        </div>

        {/* Validation error */}
        {showError && !allStepsFilled() && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-card mb-4 animate-slide-up"
            style={{ background: "rgba(255,59,48,0.10)", border: "1px solid rgba(255,59,48,0.12)" }}>
            <AlertTriangle size={14} className="text-error shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="text-error font-medium">请完成以下步骤：</span>
              <span className="text-text-secondary"> {getMissingSteps().join("、")}</span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button onClick={()=>setCurrentStep(i=>Math.max(0,i-1))} disabled={currentStep===0}
            className="control-btn disabled:opacity-30">上一步</button>
          {currentStep<steps.length-1 ? (
            <button onClick={()=>setCurrentStep(i=>Math.min(steps.length-1,i+1))}
              disabled={!isCurrentStepValid}
              className="primary-cta h-9">下一步 <ArrowRight size={13}/></button>
          ) : (
            <button onClick={handleComplete} disabled={saving || !isCurrentStepValid}
              className="primary-cta h-9">{saving?"保存中...":"完成设置"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
