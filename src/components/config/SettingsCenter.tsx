import { useState, useEffect, useRef } from "react";
import {
  Settings,
  Folder,
  User,
  Palette,
  ScanEye,
  Cat,
  ShieldAlert,
  FolderOpen,
  RotateCw,
  X,
  Play
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useGlobalConfig } from "../../store/globalConfig";
import { useAccounts } from "../../store/accounts";
import { useTheme } from "../../store/theme";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Toggle } from "../ui/Toggle";
import { Input } from "../ui/Input";
import { showToast } from "../ui/Toast";
import { parseShortcutFromKeyEvent, useShortcutRecorder } from "../../hooks/useShortcutRecorder";
import {
  DisplaySection,
  GraphicsSection,
  AudioSection,
  GameplaySection,
  AutomapSection,
  SettingsMap
} from "../../pages/SettingsEditor";
import type { GlobalConfig } from "../../store/types";

// Helper for quadratic opacity mapping
// Map slider value s (0..100) to stored percentage p (10..100)
function sliderToPercent(s: number): number {
  return Math.round(10 + 0.009 * s * s);
}

// Map stored percentage p (10..100) to slider value s (0..100)
function percentToSlider(p: number): number {
  if (p <= 10) return 0;
  return Math.round(100 * Math.sqrt((p - 10) / 90));
}

interface Props {
  open: boolean;
  onClose: () => void;
  onReconfigure: () => void;
  initialTab?: string | null;
  initialAccountId?: string | null;
}

type TabType =
  | "paths"
  | "accounts"
  | "agent"
  | "appearance"
  | "ocr"
  | "pet"
  | "shortcuts"
  | "advanced";

export function SettingsCenter({ open, onClose, onReconfigure, initialTab, initialAccountId }: Props) {
  const { config, save, detectBattleNetPath, detectSavedGamesPath, detectProgramDataAgentPath, detectAppDataRoamingBnetPath, detectBrowserPath } = useGlobalConfig();
  const { accounts, loadAccounts, renameAccount, updateAccountMods, repairAllRegistries } = useAccounts();
  const { theme, setTheme } = useTheme();

  // Tab and search state
  const [activeTab, setActiveTab] = useState<TabType>("accounts");
  const [settingsJsonAvailable, setSettingsJsonAvailable] = useState<boolean | null>(null);

  // Config backup for rollback
  const [originalConfig, setOriginalConfig] = useState<GlobalConfig | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    if (!open || !config?.saved_games_path) {
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
  }, [open, config?.saved_games_path]);

  // Game settings edit states (per account)
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [gameSettings, setGameSettings] = useState<SettingsMap>({});
  const [gameSettingsLoading, setGameSettingsLoading] = useState(false);
  const [gameSettingsChanged, setGameSettingsChanged] = useState(false);
  const [gameSettingsSaving, setGameSettingsSaving] = useState(false);
  const [_fontScaleKey, setFontScaleKey] = useState(0);
  const [gameSettingsTab, setGameSettingsTab] = useState<"launch" | "game_display" | "game_graphics" | "game_audio" | "game_gameplay" | "game_automap">("launch");

  // Account card values draft states
  const [accountNicknameDraft, setAccountNicknameDraft] = useState("");
  const [accountModArgsDraft, setAccountModArgsDraft] = useState("");
  const [accountWinXDraft, setAccountWinXDraft] = useState<number | null>(null);
  const [accountWinYDraft, setAccountWinYDraft] = useState<number | null>(null);

  // Shortcut key recording state (shared hook)
  const { recordingPos, setRecordingPos } = useShortcutRecorder();

  // Local detected paths
  const [detectedPaths, setDetectedPaths] = useState<Record<string, string | null>>({});

  // Auto initialize selected account and active tab
  // Backup config for rollback when modal opens
  useEffect(() => {
    if (open && config) {
      setOriginalConfig(JSON.parse(JSON.stringify(config)));
    }
  }, [open]);

  // Auto initialize selected account and active tab
  useEffect(() => {
    if (open) {
      if (initialTab) {
        setActiveTab(initialTab as TabType);
      } else {
        setActiveTab("accounts");
      }

      // Pre-select account if provided
      const activeAccounts = accounts.filter(a => a.initialized);
      if (initialAccountId) {
        setSelectedAccountId(initialAccountId);
      } else if (activeAccounts.length > 0) {
        setSelectedAccountId(activeAccounts[0].id);
      } else if (accounts.length > 0) {
        setSelectedAccountId(accounts[0].id);
      }

      // Detect paths
      (async () => {
        const bnet = await detectBattleNetPath();
        const savedGames = await detectSavedGamesPath();
        const agent = await detectProgramDataAgentPath();
        const roaming = await detectAppDataRoamingBnetPath();
        const browser = await detectBrowserPath();
        setDetectedPaths({
          bnet,
          savedGames,
          agent,
          roaming,
          browser: browser ? browser[0] : null,
        });
      })();
    }
  }, [open, initialTab, initialAccountId]);

  // Load account parameters draft when selected account changes
  useEffect(() => {
    if (selectedAccountId) {
      const acc = accounts.find(a => a.id === selectedAccountId);
      if (acc) {
        setAccountNicknameDraft(acc.display_name || acc.id);
        setAccountModArgsDraft(acc.mod_args || "");
        setAccountWinXDraft(acc.window_x !== undefined ? acc.window_x : null);
        setAccountWinYDraft(acc.window_y !== undefined ? acc.window_y : null);
        loadGameSettings(selectedAccountId);
      }
    }
  }, [selectedAccountId, accounts]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      unlisten = await listen<{ accountId: string }>("account-settings-updated", (event) => {
        if (event.payload.accountId === selectedAccountId && !gameSettingsSaving) {
          loadGameSettings(selectedAccountId);
        }
      });
    };
    if (selectedAccountId) {
      setupListener();
    }
    return () => {
      if (unlisten) unlisten();
    };
  }, [selectedAccountId, gameSettingsSaving]);

  const loadGameSettings = async (accId: string) => {
    setGameSettingsLoading(true);
    try {
      const data = await invoke<SettingsMap>("get_account_settings", { accountId: accId });
      setGameSettings(data);
      setGameSettingsChanged(false);
    } catch (e) {
      showToast("error", `加载账号游戏配置失败: ${e}`);
    } finally {
      setGameSettingsLoading(false);
    }
  };

  // Close / Rollback
  const handleClose = () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    const closeAfterSave = async () => {
      try {
        if (config && globalHasChanges) {
          await handleSaveGlobal(true);
        }
        if (accountHasChanges) {
          await handleSaveAccount(true);
        }
      } catch (e) {
        showToast("error", `保存失败: ${e}`);
      } finally {
        onClose();
      }
    };

    void closeAfterSave();
  };

  // Global Config Save
  const handleSaveGlobal = async (quiet = false) => {
    if (!config) return;
    try {
      await save(config);
      setOriginalConfig(JSON.parse(JSON.stringify(config)));
      if (!quiet) showToast("success", "全局设置已成功保存");
    } catch (e) {
      showToast("error", `保存全局设置失败: ${e}`);
    }
  };

  // Selected Account Config Save (includes basic metadata and game settings file)
  const handleSaveAccount = async (quiet = false) => {
    if (!selectedAccountId) return;
    setGameSettingsSaving(true);
    try {
      const acc = accounts.find(a => a.id === selectedAccountId);
      if (!acc) return;

      // 1. Rename if modified
      if (accountNicknameDraft.trim() && accountNicknameDraft.trim() !== (acc.display_name || acc.id)) {
        await renameAccount(selectedAccountId, accountNicknameDraft.trim());
      }

      // 2. Set Mod args if modified
      if (accountModArgsDraft !== acc.mod_args) {
        const mods = acc.mod_list || [];
        const val = accountModArgsDraft.trim();
        const newList = (val && !mods.includes(val)) ? [...mods, val] : mods;
        await updateAccountMods(selectedAccountId, val, newList);
      }

      // 3. Set Window position if modified
      if (accountWinXDraft !== acc.window_x || accountWinYDraft !== acc.window_y) {
        await invoke("set_account_window_position", {
          accountId: selectedAccountId,
          windowX: accountWinXDraft,
          windowY: accountWinYDraft,
        });
      }

      // 4. Save game settings if modified
      if (gameSettingsChanged) {
        await invoke("save_account_settings", {
          accountId: selectedAccountId,
          settings: gameSettings,
        });
        setGameSettingsChanged(false);
        await emit("account-settings-updated", { accountId: selectedAccountId });
      }

      await loadAccounts();
      const savedName = accountNicknameDraft.trim() || acc.display_name || acc.id;
      if (!quiet) showToast("success", `账号 "${savedName}" 的设置已保存`);
    } catch (e) {
      showToast("error", `保存账号设置失败: ${e}`);
    } finally {
      setGameSettingsSaving(false);
    }
  };

  const handleSnapshotSystemSettings = async () => {
    if (!selectedAccountId) return;
    try {
      const settings = await invoke<SettingsMap>("snapshot_system_settings_to_account", {
        accountId: selectedAccountId,
      });
      setGameSettings(settings);
      setGameSettingsChanged(false);
      await loadAccounts();
      await emit("account-settings-updated", { accountId: selectedAccountId });
      showToast("success", "已快照系统配置到当前账号");
    } catch (e) {
      showToast("error", `快照系统配置失败: ${e}`);
    }
  };

  const handleToggleAccountSettingsMode = async (accountId: string, customized: boolean) => {
    try {
      await invoke("set_settings_customized", { accountId, customized });
      await loadAccounts();
      if (accountId === selectedAccountId) {
        await loadGameSettings(accountId);
      }
      await emit("account-settings-updated", { accountId });
    } catch (e) {
      showToast("error", `切换配置模式失败: ${e}`);
    }
  };

  // Local Config Mutation helper
  const updateConfig = (updater: (c: GlobalConfig) => void) => {
    if (config) {
      const clone = { ...config };
      updater(clone);
      useGlobalConfig.setState({ config: clone });
    }
  };

  const updateGameSetting = (key: string, value: unknown) => {
    setGameSettings(prev => ({ ...prev, [key]: value }));
    setGameSettingsChanged(true);
  };

  // Path pickers
  const pickFile = async (field: keyof GlobalConfig, title: string, extensions?: string[]) => {
    try {
      const sel = await openDialog({
        multiple: false,
        title,
        filters: extensions ? [{ name: title, extensions }] : undefined,
      });
      if (sel) {
        updateConfig(c => {
          (c as any)[field] = sel;
        });
      }
    } catch (e) {
      showToast("error", `选择文件失败: ${e}`);
    }
  };

  const pickFolder = async (field: keyof GlobalConfig, title: string) => {
    try {
      const sel = await openDialog({
        multiple: false,
        directory: true,
        title,
      });
      if (sel) {
        updateConfig(c => {
          (c as any)[field] = sel;
        });
      }
    } catch (e) {
      showToast("error", `选择目录失败: ${e}`);
    }
  };

  const applyDetectedPath = (field: keyof GlobalConfig, value: string | null) => {
    if (value) {
      updateConfig(c => {
        (c as any)[field] = value;
      });
      showToast("success", "成功自动应用检测到的路径");
    } else {
      showToast("warning", "未能检测到默认路径，请手动选择");
    }
  };

  // Keyboard shortcut listener
  const handleShortcutKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, pos: string) => {
    e.preventDefault();
    e.stopPropagation();

    const combo = parseShortcutFromKeyEvent(e);
    if (!combo) return;

    if (config) {
      let bindings: Record<string, string> = {};
      try {
        bindings = config.shortcut_bindings_json ? JSON.parse(config.shortcut_bindings_json) : {};
      } catch {
        bindings = {};
      }
      bindings[pos] = combo;
      updateConfig(c => {
        c.shortcut_bindings_json = JSON.stringify(bindings);
      });
    }

    setRecordingPos(null);
    (e.target as HTMLInputElement).blur();
    showToast("success", `快捷键已配置为: ${combo}`);
  };

  const handleClearShortcut = (pos: string) => {
    if (config) {
      let bindings: Record<string, string> = {};
      try {
        bindings = config.shortcut_bindings_json ? JSON.parse(config.shortcut_bindings_json) : {};
      } catch {
        bindings = {};
      }
      delete bindings[pos];
      updateConfig(c => {
        c.shortcut_bindings_json = JSON.stringify(bindings);
      });
      showToast("info", "快捷键已清除");
    }
  };

  // Check if global config has changes compared to original
  const globalHasChanges = config && originalConfig && JSON.stringify(config) !== JSON.stringify(originalConfig);

  // Check if account-level settings have unsaved changes
  const accountHasChanges = (() => {
    if (!selectedAccountId) return false;
    const acc = accounts.find(a => a.id === selectedAccountId);
    if (!acc) return false;
    return (
      (accountNicknameDraft.trim() && accountNicknameDraft.trim() !== (acc.display_name || acc.id)) ||
      accountModArgsDraft !== (acc.mod_args || "") ||
      accountWinXDraft !== (acc.window_x ?? null) ||
      accountWinYDraft !== (acc.window_y ?? null) ||
      gameSettingsChanged
    );
  })();

  const hasUnsavedChanges = globalHasChanges || accountHasChanges;

  const autoSaveKey = JSON.stringify({
    selectedAccountId,
    accountNicknameDraft,
    accountModArgsDraft,
    accountWinXDraft,
    accountWinYDraft,
    gameSettingsChanged,
    gameSettings,
    config,
  });

  useEffect(() => {
    if (!open || !hasUnsavedChanges) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      (async () => {
        if (config && globalHasChanges) {
          await handleSaveGlobal(true);
        }
        if (accountHasChanges) {
          await handleSaveAccount(true);
        }
      })().catch(e => showToast("error", `自动保存失败: ${e}`));
    }, 800);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [open, hasUnsavedChanges, autoSaveKey]);

  // Group Tabs List
  const navTabs: { id: TabType; label: string; icon: any; desc: string }[] = [
    { id: "paths", label: "连接", icon: Folder, desc: "战网、游戏、浏览器与存档位置" },
    { id: "accounts", label: "账号", icon: User, desc: "昵称、启动方式、窗口和画质" },
    { id: "agent", label: "启动策略", icon: Play, desc: "战网 Agent 与启动等待策略" },
    { id: "shortcuts", label: "快捷键", icon: Settings, desc: "账号窗口切换与聚焦" },
    { id: "appearance", label: "显示", icon: Palette, desc: "主题、透明度、字体和悬浮窗" },
    ...(import.meta.env.VITE_ENABLE_OCR !== "false" ? [{ id: "ocr" as TabType, label: "自动化", icon: ScanEye, desc: "OCR、统计、识别频率与账户" }] : []),
    { id: "pet", label: "伴随", icon: Cat, desc: "桌宠与轻量状态提示" },
    { id: "advanced", label: "维护", icon: ShieldAlert, desc: "修复、日志、重置和向导" },
  ];

  // Search filter
  const filteredTabs = navTabs;

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);
  const accountRegionLabel = (region?: string | null) =>
    region === "KR" ? "亚服" : region === "NA" ? "美服" : region === "EU" ? "欧服" : region === "Global" ? "国际服" : "国服";
  const gameSubTabs: { id: typeof gameSettingsTab; label: string }[] = [
    { id: "launch", label: "启动" },
    { id: "game_display", label: "显示" },
    { id: "game_graphics", label: "图形" },
    { id: "game_audio", label: "音频" },
    { id: "game_gameplay", label: "玩法" },
    { id: "game_automap", label: "地图" },
  ];
  const saveStatusText = gameSettingsSaving
    ? "自动保存中"
    : hasUnsavedChanges
      ? "有未保存改动"
      : "已自动保存";

  return (
    <Modal open={open} onClose={handleClose} title={`设置中心 · ${saveStatusText}`} width="max-w-[1020px]" closeOnContextMenu>
      <div className="settings-center-shell flex h-[640px] max-h-[90vh] flex-col">
        <div className="settings-center-nav shrink-0">
          <div className="grid grid-cols-8 gap-2 max-[1180px]:grid-cols-4 max-[720px]:grid-cols-2">
            {filteredTabs.map((t, idx) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className="setting-category-tile"
                  data-active={activeTab === t.id ? "true" : "false"}
                >
                  <div className="flex items-center justify-between">
                    <span className="tile-index">{String(idx + 1).padStart(2, "0")}</span>
                    <Icon size={13} className="text-text-muted" strokeWidth={1.8} />
                  </div>
                  <span className="text-base font-bold leading-none text-text-primary">{t.label}</span>
                  <span className="micro-meta truncate">{t.desc}</span>
                </button>
              );
            })}
            {filteredTabs.length === 0 && (
              <div className="spatial-panel col-span-full px-4 py-5 text-center text-xs text-text-muted">无匹配结果</div>
            )}
          </div>
        </div>

          {/* Tab content area */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2 pr-1">
            {/* 1. Paths Tab */}
            {activeTab === "paths" && config && (
              <div className="settings-content-grid">
                <div className="spatial-panel p-3 space-y-2">
                  <h3 className="text-xs font-bold text-text-primary">核心程序路径</h3>

                  <div className="space-y-2">
                    <label className="text-xs text-text-muted block">战网客户端路径 (Battle.net.exe)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={config.battle_net_path}
                        readOnly
                        className="flex-1 h-8 px-3 rounded-lg bg-surface-hover text-xs border border-border-default text-text-primary"
                      />
                      <Button size="sm" onClick={() => pickFile("battle_net_path", "Battle.net.exe", ["exe"])}>浏览</Button>
                      <Button size="sm" onClick={() => applyDetectedPath("battle_net_path", detectedPaths.bnet)}>自动探测</Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-text-muted block">游戏安装目录 (Diablo II Resurrected)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={config.game_path}
                        readOnly
                        className="flex-1 h-8 px-3 rounded-lg bg-surface-hover text-xs border border-border-default text-text-primary"
                      />
                      <Button size="sm" onClick={() => pickFolder("game_path", "游戏安装目录")}>浏览</Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-text-muted block">游戏存档目录 (Saved Games)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={config.saved_games_path}
                        readOnly
                        className="flex-1 h-8 px-3 rounded-lg bg-surface-hover text-xs border border-border-default text-text-primary"
                      />
                      <Button size="sm" onClick={() => pickFolder("saved_games_path", "存档目录")}>浏览</Button>
                      <Button size="sm" onClick={() => applyDetectedPath("saved_games_path", detectedPaths.savedGames)}>自动探测</Button>
                    </div>
                    {settingsJsonAvailable === false && (
                      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg"
                        style={{ background: "var(--toast-warning-bg)", border: "1px solid var(--toast-warning-border)" }}>
                        <ShieldAlert size={14} className="text-warning shrink-0 mt-0.5" />
                        <p className="text-xs text-text-secondary leading-relaxed">
                          未检测到 Settings.json。账号创建、登录和多开不受影响，但系统画质读取、账号独立画质配置与覆盖暂不可用。
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="spatial-panel p-3 space-y-2">
                  <h3 className="text-xs font-bold text-text-primary">战网/浏览器隔离辅助路径</h3>

                  <div className="space-y-2">
                    <label className="text-xs text-text-muted block">战网进程 Agent.exe 目录</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={config.program_data_agent_path}
                        readOnly
                        className="flex-1 h-8 px-3 rounded-lg bg-surface-hover text-xs border border-border-default text-text-primary"
                      />
                      <Button size="sm" onClick={() => pickFolder("program_data_agent_path", "Agent 目录")}>浏览</Button>
                      <Button size="sm" onClick={() => applyDetectedPath("program_data_agent_path", detectedPaths.agent)}>自动探测</Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-text-muted block">战网 Roaming AppData 目录</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={config.app_data_roaming_bnet_path}
                        readOnly
                        className="flex-1 h-8 px-3 rounded-lg bg-surface-hover text-xs border border-border-default text-text-primary"
                      />
                      <Button size="sm" onClick={() => pickFolder("app_data_roaming_bnet_path", "Roaming 战网目录")}>浏览</Button>
                      <Button size="sm" onClick={() => applyDetectedPath("app_data_roaming_bnet_path", detectedPaths.roaming)}>自动探测</Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-text-muted block">独立隔离浏览器程序 (Edge/Chrome.exe)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={config.browser_path}
                        readOnly
                        className="flex-1 h-8 px-3 rounded-lg bg-surface-hover text-xs border border-border-default text-text-primary"
                      />
                      <Button size="sm" onClick={() => pickFile("browser_path", "chrome.exe/msedge.exe", ["exe"])}>浏览</Button>
                      <Button size="sm" onClick={() => applyDetectedPath("browser_path", detectedPaths.browser)}>自动探测</Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div>
                      <span className="text-sm font-semibold text-text-secondary">隔离浏览器类型</span>
                      <p className="text-2xs text-text-muted">当前选择的沙箱浏览器品牌</p>
                    </div>
                    <select
                      value={config.browser_type}
                      onChange={e => updateConfig(c => { c.browser_type = e.target.value; })}
                      className="h-7 px-2.5 rounded-lg bg-surface-hover border border-border-default text-text-primary text-xs"
                    >
                      <option value="">未指定</option>
                      <option value="chrome">Google Chrome</option>
                      <option value="edge">Microsoft Edge</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Accounts & Launch Tab */}
            {activeTab === "accounts" && (
              <div className="space-y-3">
                {accounts.length === 0 ? (
                  <div className="spatial-panel py-10 text-center text-sm text-text-muted">请先在主界面点击“添加账号”创建新账号</div>
                ) : (
                  <div className="grid grid-cols-[248px_minmax(0,1fr)] gap-3 max-[880px]:grid-cols-1">
                    <div className="space-y-1.5 max-[880px]:order-2">
                      {accounts.map((a, idx) => {
                        const active = a.id === selectedAccountId;
                        const overrideEnabled = !!a.has_customized_settings;
                        return (
                          <button
                            key={a.id}
                            onClick={async () => {
                              if (a.id === selectedAccountId) return;
                              if (accountHasChanges) {
                                await handleSaveAccount(true);
                              }
                              setSelectedAccountId(a.id);
                            }}
                            className="account-option w-full text-left"
                            data-selected={active ? "true" : "false"}
                          >
                            <div className="account-option-top">
                              <div className="min-w-0">
                                <span className="tile-index">{String(idx + 1).padStart(2, "0")}</span>
                                <div className="account-option-name truncate">{a.display_name || a.id}</div>
                              </div>
                              <div className="flex shrink-0 items-start gap-2">
                                <label
                                  className="option-line option-line-inline"
                                  onClick={e => e.stopPropagation()}
                                  title="覆盖游戏配置"
                                >
                                  <input
                                    type="checkbox"
                                    className="sr-only"
                                    checked={overrideEnabled}
                                    onChange={e => void handleToggleAccountSettingsMode(a.id, e.target.checked)}
                                  />
                                  <span className={overrideEnabled ? "check-box checked" : "check-box"} />
                                  <span>覆盖游戏配置</span>
                                </label>
                                <span className={a.initialized ? "account-state-dot" : "account-state-dot warn"} />
                              </div>
                            </div>
                            <div className="account-option-meta">
                              <span className="hig-badge hig-badge-neutral">{accountRegionLabel(a.region)}</span>
                              <span className={a.auth_mode === "token" ? "hig-badge hig-badge-violet" : "hig-badge hig-badge-blue"}>
                                {a.auth_mode === "token" ? "网页 Token" : "战网认证"}
                              </span>
                              {!a.initialized && <span className="hig-badge hig-badge-red">未初始化</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {selectedAccountId && selectedAccount && (
                      <div className="setting-card min-h-[340px] max-[880px]:order-1">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-border-default pb-3">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-text-primary">{selectedAccount.display_name || selectedAccount.id} · 画质与启动</p>
                            <p className="micro-meta mt-1">账号字段、启动参数和游戏内配置在这里完成。</p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <button
                              type="button"
                              onClick={handleSnapshotSystemSettings}
                              className="control-btn h-8 px-3"
                            >
                              快照系统配置
                            </button>
                            <div className="settings-subnav">
                              {gameSubTabs.map(tab => (
                                <button
                                  key={tab.id}
                                  onClick={() => setGameSettingsTab(tab.id)}
                                  className="control-btn h-8 px-3"
                                  data-active={gameSettingsTab === tab.id ? "true" : "false"}
                                >
                                  {tab.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {gameSettingsTab === "launch" && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
                              <Input
                                label="昵称"
                                value={accountNicknameDraft}
                                onChange={e => setAccountNicknameDraft(e.target.value)}
                              />
                              <Input
                                label="Mod 参数"
                                value={accountModArgsDraft}
                                onChange={e => setAccountModArgsDraft(e.target.value)}
                                placeholder="-mod custom -txt"
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
                              <Input
                                label="窗口 X"
                                type="number"
                                value={accountWinXDraft !== null ? accountWinXDraft : ""}
                                onChange={e => setAccountWinXDraft(e.target.value !== "" ? Number(e.target.value) : null)}
                                placeholder="默认"
                              />
                              <Input
                                label="窗口 Y"
                                type="number"
                                value={accountWinYDraft !== null ? accountWinYDraft : ""}
                                onChange={e => setAccountWinYDraft(e.target.value !== "" ? Number(e.target.value) : null)}
                                placeholder="默认"
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
                              <div>
                                <label className="micro-meta mb-1.5 block">分辨率</label>
                                <select
                                  value={String(gameSettings["Screen Resolution (Windowed)"] ?? "1280x720")}
                                  onChange={e => updateGameSetting("Screen Resolution (Windowed)", e.target.value)}
                                  className="line-select w-full px-2.5"
                                >
                                  {["1280x720","1600x900","1920x1080","2560x1440","3840x2160"].map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="micro-meta mb-1.5 block">FPS</label>
                                <div className="combo-input">
                                  <input
                                    type="number"
                                    min={0}
                                    max={500}
                                    list="settings-center-fps-options"
                                    value={Number(gameSettings["Framerate Target"] ?? gameSettings["Framerate Cap"] ?? 60)}
                                    onChange={e => updateGameSetting("Framerate Target", Math.max(0, Math.min(300, Number(e.target.value) || 0)))}
                                  />
                                  <datalist id="settings-center-fps-options">
                                    {[0, 30, 60, 120, 144, 240].map(f => <option key={f} value={f}>{f === 0 ? "无限制" : `${f} FPS`}</option>)}
                                  </datalist>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {gameSettingsTab !== "launch" && gameSettingsLoading && (
                          <div className="space-y-3 py-4">
                            {[1, 2, 3].map(i => (
                              <div key={i} className="h-9 skeleton rounded-lg" />
                            ))}
                          </div>
                        )}

                        {gameSettingsTab !== "launch" && !gameSettingsLoading && (
                          <div className="space-y-4">
                            {gameSettingsTab === "game_display" && (
                              <DisplaySection settings={gameSettings} update={updateGameSetting} />
                            )}
                            {gameSettingsTab === "game_graphics" && (
                              <GraphicsSection settings={gameSettings} update={updateGameSetting} />
                            )}
                            {gameSettingsTab === "game_audio" && (
                              <AudioSection settings={gameSettings} update={updateGameSetting} />
                            )}
                            {gameSettingsTab === "game_gameplay" && (
                              <GameplaySection settings={gameSettings} update={updateGameSetting} />
                            )}
                            {gameSettingsTab === "game_automap" && (
                              <AutomapSection settings={gameSettings} update={updateGameSetting} />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 3. Multi-Agent Tab */}
            {activeTab === "agent" && config && (
              <div className="settings-content-grid">
                <div className="spatial-panel p-3 space-y-2">
                  <div>
                    <span className="text-sm font-semibold text-text-secondary uppercase tracking-wider block mb-1">多开 Agent 限制行为</span>
                    <p className="text-2xs text-text-muted">防止启动多个战网客户端冲突的控制策略</p>
                  </div>

                  <div className="flex gap-2">
                    {[1, 2, 3].map(mode => {
                      const label = mode === 1 ? "模式1：延时杀" : mode === 2 ? "模式2：进程数杀" : "模式3：不处理";
                      const active = (config.agent_mode ?? 1) === mode;
                      return (
                        <button
                          key={mode}
                          onClick={() => updateConfig(c => { c.agent_mode = mode; })}
                          className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150 border ${
                            active
                              ? "border-accent bg-accent/10 text-accent font-bold"
                              : "border-border-default text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Mode 1 Details */}
                  {(config.agent_mode ?? 1) === 1 && (
                    <div className="px-3 py-2.5 spatial-panel space-y-2">
                      <span className="text-xs text-text-muted font-medium block">检测到 Agent 后延迟杀死（秒）</span>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={30}
                          step={0.1}
                          value={config.agent_delay_secs ?? 1}
                          onChange={e => updateConfig(c => { c.agent_delay_secs = parseFloat(parseFloat(e.target.value).toFixed(1)); })}
                          className="flex-1 h-1.5 rounded-full appearance-none bg-surface-hover cursor-pointer"
                        />
                        <span className="text-xs font-mono text-text-primary w-12 text-right font-bold">
                          {(config.agent_delay_secs ?? 1).toFixed(1)}s
                        </span>
                      </div>
                      <p className="text-2xs text-text-muted">在此时间内继续进行后续挂载或登录行为而不阻塞。默认 1.0s，范围 0-30s，最小粒度 0.1s</p>
                    </div>
                  )}

                  {/* Mode 2 Details */}
                  {(config.agent_mode ?? 1) === 2 && (
                    <div className="px-3 py-2.5 spatial-panel space-y-2">
                      <span className="text-xs text-text-muted font-medium block">战网客户端运行数阈值</span>
                      <div className="flex gap-2">
                        {[5, 7].map(n => {
                          const active = (config.agent_threshold ?? 5) === n;
                          return (
                            <button
                              key={n}
                              onClick={() => updateConfig(c => { c.agent_threshold = n; })}
                              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 border ${
                                active
                                  ? "border-accent bg-accent/10 text-accent font-bold"
                                  : "border-border-default text-text-secondary hover:text-text-primary"
                              }`}
                            >
                              ≥ {n} 运行客户端
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-2xs text-text-muted">仅当活跃战网进程数达到或超过阈值时才终结 Agent，避免多开限制发生。</p>
                    </div>
                  )}
                </div>

                <div className="spatial-panel p-3 space-y-2">
                  <h3 className="text-xs font-bold text-text-primary">辅助自动脚本选项</h3>

                  <div className="flex items-center justify-between py-1.5">
                    <div>
                      <span className="text-sm font-semibold text-text-secondary">自动关闭隔离浏览器</span>
                      <p className="text-2xs text-text-muted">在账号挂载或登录完自动关闭浏览器以释放内存</p>
                    </div>
                    <Toggle
                      checked={!!config.auto_close_browser}
                      onChange={v => updateConfig(c => { c.auto_close_browser = v; })}
                    />
                  </div>

                  <div className="flex items-center justify-between py-1.5 border-t border-border-default/50 pt-2">
                    <div>
                      <span className="text-sm font-semibold text-text-secondary">每日检查更新</span>
                      <p className="text-2xs text-text-muted">每天第一次启动多开工具时自动检测新版本</p>
                    </div>
                    <Toggle
                      checked={!!config.enable_auto_update}
                      onChange={v => updateConfig(c => { c.enable_auto_update = v; })}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 4. Window & Appearance Tab */}
            {activeTab === "appearance" && config && (
              <div className="settings-content-grid">
                <div className="spatial-panel p-3 space-y-2">
                  <h3 className="text-xs font-bold text-text-primary">界面语言</h3>
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <span className="text-sm font-semibold text-text-secondary">软件界面显示语言</span>
                      <p className="text-2xs text-text-muted">软件界面显示语言，场景识别和符文名称不受影响</p>
                    </div>
                    <select
                      value={config.app_language || "zh-CN"}
                      onChange={async e => {
                        const language = e.target.value;
                        updateConfig(c => { c.app_language = language; });
                        const cur = useGlobalConfig.getState().config;
                        if (cur) await save({ ...cur, app_language: language });
                      }}
                      className="h-8 px-2.5 rounded-lg bg-surface-hover border border-border-default text-text-primary text-xs"
                    >
                      <option value="zh-CN">中文</option>
                      <option value="en-US">English</option>
                    </select>
                  </div>
                </div>

                <div className="spatial-panel p-3 space-y-2">
                  <h3 className="text-xs font-bold text-text-primary">主程序窗口主题</h3>
                  <div className="grid grid-cols-2 gap-2.5">
                    {([
                      { id: "onyx", label: "深色主题 (Onyx)", desc: "暗黑色调与黄金文字" },
                      { id: "light", label: "浅色主题 (Light)", desc: "极简素雅明亮界面" }
                    ] as const).map(t => {
                      const active = theme === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setTheme(t.id)}
                          className="flex flex-col items-start gap-1 p-3 rounded-xl border transition-all text-left"
                          style={{
                            borderColor: active ? "var(--accent)" : "var(--border-default)",
                            background: active ? "var(--surface-hover)" : "transparent"
                          }}
                        >
                          <span className={`text-md font-bold ${active ? "text-accent" : "text-text-primary"}`}>{t.label}</span>
                          <span className="text-2xs text-text-muted">{t.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="spatial-panel p-3 space-y-2">
                  <h3 className="text-xs font-bold text-text-primary">性能悬浮窗主题</h3>
                  <div className="grid grid-cols-2 gap-2.5">
                    {([
                      { id: "onyx", label: "深色悬浮窗", desc: "暗黑半透质感" },
                      { id: "light", label: "浅色悬浮窗", desc: "明亮半透玻璃" }
                    ] as const).map(t => {
                      const active = (config.theme_overlay || "light") === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={async () => {
                            updateConfig(c => { c.theme_overlay = t.id; });
                            const cur = useGlobalConfig.getState().config;
                            if (cur) await save({ ...cur, theme_overlay: t.id });
                          }}
                          className="flex flex-col items-start gap-1 p-3 rounded-xl border transition-all text-left"
                          style={{
                            borderColor: active ? "var(--accent)" : "var(--border-default)",
                            background: active ? "var(--surface-hover)" : "transparent"
                          }}
                        >
                          <span className={`text-md font-bold ${active ? "text-accent" : "text-text-primary"}`}>{t.label}</span>
                          <span className="text-2xs text-text-muted">{t.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="spatial-panel p-3 space-y-2">
                  <h3 className="text-xs font-bold text-text-primary">背景不透明度 (不影响内容/文字)</h3>

                  {/* Main window opacity */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-text-secondary">主界面背景不透明度</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={10}
                          max={100}
                          value={config.main_opacity ?? 95}
                          onChange={e => {
                            const val = Math.max(10, Math.min(100, parseInt(e.target.value) || 10));
                            updateConfig(c => { c.main_opacity = val; });
                          }}
                          className="w-12 h-6 px-1 rounded bg-surface-hover text-center font-mono text-xs text-text-primary border border-border-default"
                        />
                        <span className="text-text-muted">%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={percentToSlider(config.main_opacity ?? 95)}
                        onChange={e => {
                          const val = sliderToPercent(parseInt(e.target.value));
                          updateConfig(c => { c.main_opacity = val; });
                        }}
                        className="flex-1 h-1.5 rounded-full appearance-none bg-surface-hover cursor-pointer"
                      />
                    </div>
                    <p className="text-2xs text-text-muted">采用非线性映射，滑动高透明度区间更灵敏，输入框可输入真实百分比 10-100</p>
                  </div>

                  {/* Overlay opacity */}
                  <div className="space-y-1 border-t border-border-default/50 pt-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-text-secondary">性能悬浮窗背景不透明度</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={10}
                          max={100}
                          value={config.overlay_opacity ?? 95}
                          onChange={e => {
                            const val = Math.max(10, Math.min(100, parseInt(e.target.value) || 10));
                            updateConfig(c => { c.overlay_opacity = val; });
                          }}
                          className="w-12 h-6 px-1 rounded bg-surface-hover text-center font-mono text-xs text-text-primary border border-border-default"
                        />
                        <span className="text-text-muted">%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={percentToSlider(config.overlay_opacity ?? 95)}
                        onChange={e => {
                          const val = sliderToPercent(parseInt(e.target.value));
                          updateConfig(c => { c.overlay_opacity = val; });
                        }}
                        className="flex-1 h-1.5 rounded-full appearance-none bg-surface-hover cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* ── 字体大小 ── */}
                <div className="spatial-panel p-3 space-y-2">
                  <h3 className="text-xs font-bold text-text-primary">字体大小</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { id: "small",   label: "小",   desc: "放大 15%" },
                      { id: "default", label: "默认", desc: "放大 30%" },
                      { id: "large",   label: "大",   desc: "放大 45%" },
                    ] as const).map(({ id, label, desc }) => {
                      const fontScale = (() => {
                        try { return document.documentElement.dataset.fontScale || "default"; }
                        catch { return "default"; }
                      })();
                      const active = fontScale === id;
                      return (
                        <button
                          key={id}
                          onClick={() => {
                            document.documentElement.dataset.fontScale = id;
                            try { localStorage.setItem("d2rhub-font-scale", id); } catch {}
                            updateConfig(c => { c.font_scale = id; });
                            const cur = useGlobalConfig.getState().config;
                            if (cur) save({ ...cur, font_scale: id });
                            setFontScaleKey(k => k + 1);
                          }}
                          className={`flex flex-col items-center gap-0.5 py-2.5 px-2 rounded-xl border transition-all ${
                            active
                              ? "border-accent bg-surface-hover"
                              : "border-border-default hover:border-border-strong"
                          }`}
                        >
                          <span className={`text-md font-bold ${active ? "text-accent" : "text-text-primary"}`}>{label}</span>
                          <span className="text-2xs text-text-muted">{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="spatial-panel p-3 space-y-2">
                  <h3 className="text-xs font-bold text-text-primary">全局性能悬浮窗配置</h3>
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <span className="text-sm font-semibold text-text-secondary">启用桌面上方的性能悬浮窗</span>
                      <p className="text-2xs text-text-muted">在游戏过程中于最上层绘制帧率与硬件资源图表</p>
                    </div>
                    <Toggle
                      checked={!!config.enable_overlay}
                      onChange={async v => {
                        updateConfig(c => { c.enable_overlay = v; });
                        const cur = useGlobalConfig.getState().config;
                        if (cur) await save({ ...cur, enable_overlay: v });
                        try {
                          const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
                          const overlayWin = await WebviewWindow.getByLabel("overlay");
                          if (overlayWin) {
                            if (v) await overlayWin.show();
                            else await overlayWin.hide();
                          }
                        } catch (e) {
                          console.error("切换悬浮窗显示失败", e);
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 5. OCR & Stats Tab */}
            {import.meta.env.VITE_ENABLE_OCR !== "false" && activeTab === "ocr" && config && (
              <div className="settings-content-grid">
                <div className="spatial-panel p-3 space-y-2">
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <span className="text-sm font-bold text-text-secondary">场景符文自动识别 (OCR)</span>
                      <p className="text-2xs text-text-muted">识别所有场景地点与符文掉落，#24 以上高级符文额外截图保存</p>
                    </div>
                    <Toggle
                      checked={!!config.ocr_enabled}
                      onChange={v => updateConfig(c => { c.ocr_enabled = v; })}
                    />
                  </div>

                  {config.ocr_enabled && (
                    <div className="space-y-3 border-t border-border-default/50 pt-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-semibold text-text-secondary">识别目标账号</span>
                          <p className="text-2xs text-text-muted">哪个游戏账号对应哪一个窗口将接受 OCR 检测</p>
                        </div>
                        <select
                          value={config.ocr_target_account || ""}
                          onChange={e => updateConfig(c => { c.ocr_target_account = e.target.value; })}
                          className="h-8 px-2.5 rounded-lg bg-surface-hover border border-border-default text-text-primary text-xs"
                        >
                          <option value="">当前聚焦窗口</option>
                          {accounts.filter(a => a.initialized).map(a => (
                            <option key={a.id} value={a.id}>{a.display_name || a.id}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-semibold text-text-secondary">OCR 帧采样轮询间隔 (ms)</span>
                          <p className="text-2xs text-text-muted">两次屏幕截取分析的时间差，设置过小可能消耗较高 CPU</p>
                        </div>
                        <select
                          value={config.ocr_poll_interval_ms ?? 500}
                          onChange={e => updateConfig(c => { c.ocr_poll_interval_ms = Number(e.target.value); })}
                          className="h-8 px-2.5 rounded-lg bg-surface-hover border border-border-default text-text-primary text-xs"
                        >
                          <option value={200}>200ms (高刷新-高负荷)</option>
                          <option value={300}>300ms (流畅响应)</option>
                          <option value={500}>500ms (平衡默认)</option>
                          <option value={1000}>1000ms (低能耗限额)</option>
                          <option value={2000}>2000ms (极佳省电)</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-semibold text-text-secondary">保存 OCR 运行调试日志</span>
                          <p className="text-2xs text-text-muted">开启后程序会在 config/test 保存每次检测的裁剪切片，利于定位识别失败问题</p>
                        </div>
                        <Toggle
                          checked={!!config.ocr_debug_output}
                          onChange={v => updateConfig(c => { c.ocr_debug_output = v; })}
                        />
                      </div>

                      {/* Restart OCR button */}
                      <div className="border-t border-border-default/50 pt-3">
                        <button
                          onClick={async () => {
                            try {
                              await invoke("stop_ocr_monitor").catch(() => {});
                              const targetAccount = accounts.find(a => a.id === config.ocr_target_account);
                              const winTitle = targetAccount?.display_name || config.ocr_target_account || "";
                              const targetPid = targetAccount?.running_pid ?? null;
                              await invoke("start_ocr_monitor", {
                                config: {
                                  window_title: winTitle,
                                  target_pid: targetPid,
                                  poll_interval_ms: config.ocr_poll_interval_ms ?? 500,
                                  debug_output: config.ocr_debug_output ?? false,
                                },
                              });
                              showToast("success", "OCR 已用新配置重启");
                            } catch (e) {
                              showToast("error", "重启 OCR 失败: " + e);
                            }
                          }}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-md font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-all duration-150"
                        >
                          <RotateCw size={13} className="shrink-0" />
                          应用配置并重启 OCR
                        </button>
                        <p className="text-2xs text-text-muted text-center mt-1">使用当前参数重新启动 OCR 识别</p>
                      </div>
                    </div>
                  )}
                </div>

                {config.ocr_enabled && (
                  <div className="spatial-panel p-4 space-y-2">
                    <span className="text-xs font-bold text-text-primary block mb-1">OCR 统计结果</span>
                    <p className="text-2xs text-text-muted">查看当前数据库内的符文掉落与统计信息</p>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            await invoke("open_stats_page");
                          } catch (e) {
                            showToast("error", `打开统计界面失败: ${e}`);
                          }
                        }}
                      >
                        <Play size={10} className="text-success fill-success" />
                        打开掉落统计图表
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 6. BongoCat Tab */}
            {activeTab === "pet" && config && (
              <div className="settings-content-grid">
                <div className="spatial-panel p-3 space-y-2">
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <span className="text-sm font-bold text-text-secondary">开启桌面交互桌宠 (BongoCat)</span>
                      <p className="text-2xs text-text-muted">启用后会在桌面上方生成一只呆萌的猫咪，能实时同步你的鼠标划过与按键敲击</p>
                    </div>
                    <Toggle
                      checked={!!config.enable_bongo_cat}
                      onChange={async v => {
                        updateConfig(c => { c.enable_bongo_cat = v; });
                        const cur = useGlobalConfig.getState().config;
                        if (cur) await save({ ...cur, enable_bongo_cat: v });
                        try {
                          const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
                          const catWin = await WebviewWindow.getByLabel("bongo-cat");
                          if (catWin) {
                            if (v) await catWin.show();
                            else await catWin.hide();
                          }
                        } catch (e) {
                          console.error("切换桌宠窗口显示失败", e);
                        }
                      }}
                    />
                  </div>

                  {config.enable_bongo_cat && (
                    <div className="space-y-3 border-t border-border-default/50 pt-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-semibold text-text-secondary">气泡对话框 (Chatterbox)</span>
                          <p className="text-2xs text-text-muted">猫咪是否会偶尔冒出搞笑的台词以及系统状态提示</p>
                        </div>
                        <Toggle
                          checked={!!config.bongo_cat_chatterbox}
                          onChange={v => updateConfig(c => { c.bongo_cat_chatterbox = v; })}
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-text-secondary">猫咪显示缩放</span>
                          <span className="font-mono text-accent font-bold">{(config.bongo_cat_scale ?? 1.0).toFixed(1)}x</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={5}
                            max={50}
                            value={Math.round((config.bongo_cat_scale ?? 1.0) * 10)}
                            onChange={async (e) => {
                              const val = parseFloat(e.target.value) / 10;
                              updateConfig(c => { c.bongo_cat_scale = val; });
                              try {
                                await save({ ...config, bongo_cat_scale: val });
                              } catch (err) {
                                console.error("保存猫咪缩放失败", err);
                              }
                            }}
                            className="flex-1 h-1.5 rounded-full appearance-none bg-surface-hover cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <div>
                          <span className="text-sm font-semibold text-text-secondary">猫咪皮肤外观</span>
                          <p className="text-2xs text-text-muted">当前选择的猫咪贴图类型</p>
                        </div>
                        <select
                          value={config.bongo_cat_skin || "original"}
                          onChange={e => updateConfig(c => { c.bongo_cat_skin = e.target.value; })}
                          className="h-8 px-2.5 rounded-lg bg-surface-hover border border-border-default text-text-primary text-xs"
                        >
                          {(config.bongo_cat_unlocked_skins || ["original"]).map(skin => (
                            <option key={skin} value={skin}>{skin === "original" ? "经典原版" : skin}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 7. Shortcuts Tab */}
            {activeTab === "shortcuts" && config && (
              <div className="settings-content-grid">
                <div className="spatial-panel p-3 space-y-2 settings-span-full">
                  <h3 className="text-xs font-bold text-text-primary">切换聚焦快捷键配置</h3>
                  <p className="text-2xs text-text-muted mb-2">按下对应组合键可以一键聚焦并切换至指定的账号游戏窗口</p>

                  <div className="space-y-2.5 pt-1">
                    {accounts.filter(a => a.initialized).map((acc, index) => {
                      const posStr = String(index + 1);
                      let bindings: Record<string, string> = {};
                      try {
                        bindings = config.shortcut_bindings_json ? JSON.parse(config.shortcut_bindings_json) : {};
                      } catch {
                        bindings = {};
                      }
                      const shortcut = bindings[posStr] || "";
                      const isRecording = recordingPos === posStr;

                      return (
                        <div key={acc.id} className="flex items-center justify-between py-1">
                          <div>
                            <span className="text-sm font-semibold text-text-secondary">
                              位置 #{posStr}: {acc.display_name || acc.id}
                            </span>
                            <p className="text-2xs text-text-muted">当前一键聚焦的物理位置 #{posStr}</p>
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={isRecording ? "请按键输入组合..." : shortcut || "无"}
                              onKeyDown={e => handleShortcutKeyDown(e, posStr)}
                              onClick={() => setRecordingPos(posStr)}
                              className={`h-7 px-3 rounded-lg text-sm font-mono text-center select-none border focus:outline-none transition-all duration-150 ${
                                isRecording
                                  ? "border-accent bg-accent/10 text-accent font-bold animate-pulse"
                                  : "border-border-default bg-surface-hover text-text-primary cursor-pointer hover:border-border-strong"
                              }`}
                              style={{ width: 140 }}
                            />
                            {shortcut && (
                              <button
                                onClick={() => handleClearShortcut(posStr)}
                                aria-label={`清除位置 ${posStr} 快捷键`}
                                className="h-7 w-7 rounded-lg border border-border-default hover:border-error hover:bg-error/5 text-text-muted hover:text-error transition-all flex items-center justify-center"
                                title="清除"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {accounts.filter(a => a.initialized).length === 0 && (
                      <p className="text-center text-xs text-text-muted py-4">无已初始化的账号</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 8. Advanced Maintenance Tab */}
            {activeTab === "advanced" && config && (
              <div className="settings-content-grid">
                <div className="spatial-panel p-3 space-y-2 settings-span-full">
                  <h3 className="text-xs font-bold text-text-primary">系统与注册表修复</h3>

                  <div className="flex items-center justify-between py-1">
                    <div>
                      <span className="text-sm font-semibold text-text-secondary">一键修复全部账号注册表</span>
                      <p className="text-2xs text-text-muted">读取配置数据为所有隔离账号重新注入注册表</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          await repairAllRegistries();
                        } catch (e) {
                          console.error(e);
                        }
                      }}
                    >
                      <RotateCw size={11} className="mr-1" />
                      修复全部
                    </Button>
                  </div>

                  <div className="flex items-center justify-between py-1 border-t border-border-default/50 pt-3">
                    <div>
                      <span className="text-sm font-semibold text-text-secondary">打开系统运行日志</span>
                      <p className="text-2xs text-text-muted">查看当前多开工具的底层系统日志以供排查故障</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          await invoke("open_logs_dir");
                        } catch (e) {
                          showToast("error", `打开日志失败: ${e}`);
                        }
                      }}
                    >
                      <FolderOpen size={11} className="mr-1" />
                      打开日志
                    </Button>
                  </div>

                  <div className="flex items-center justify-between py-1 border-t border-border-default/50 pt-3">
                    <div>
                      <span className="text-sm font-semibold text-text-secondary">重新配置游戏路径</span>
                      <p className="text-2xs text-text-muted">重新运行首次引导向导以修改基础路径配置</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        onClose();
                        onReconfigure();
                      }}
                    >
                      <Settings size={11} className="mr-1" />
                      运行向导
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
    </Modal>
  );
}
