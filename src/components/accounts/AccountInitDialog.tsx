import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Circle } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useAccounts } from "../../store/accounts";
import { useGlobalConfig } from "../../store/globalConfig";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "../ui/Toast";
import type { AccountMeta } from "../../store/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: (accountId: string) => void;
  updateAccount?: AccountMeta | null;
}

type InitStep =
  | "input_nickname"
  | "creating"
  | "browser_setup"
  | "browser_launch"
  | "launching_bnet"
  | "waiting_login"
  | "collecting"
  | "done";

const bnetSteps = [
  { id: "input_nickname" as const, label: "输入昵称", desc: "为账号设置一个本地昵称" },
  { id: "creating" as const, label: "创建配置", desc: "创建本地账号存储目录" },
  { id: "browser_setup" as const, label: "浏览器配置", desc: "创建独立浏览器配置" },
  { id: "browser_launch" as const, label: "启动浏览器", desc: "打开浏览器" },
  { id: "launching_bnet" as const, label: "启动战网", desc: "打开 Battle.net 登录界面" },
  { id: "waiting_login" as const, label: "等待登录", desc: "请在战网中完成登录" },
  { id: "collecting" as const, label: "收集快照", desc: "保存认证与配置信息" },
  { id: "done" as const, label: "完成", desc: "" },
];

// ---------- Token wizard steps ----------
type TokenWizardStep = "token_nick" | "token_auth" | "token_guide" | "token_paste" | "token_settings";

const getTokenUrl = (region: string): string => {
  switch (region) {
    case "KR": return "https://kr.battle.net/login/en/?externalChallenge=login&app=OSI";
    case "NA": return "https://us.battle.net/login/en/?externalChallenge=login&app=OSI";
    case "EU": return "https://eu.battle.net/login/en/?externalChallenge=login&app=OSI";
    default: return "https://account.battlenet.com.cn/login/zh/?externalChallenge=login&app=OSI";
  }
};

const getTokenPrefix = (region: string): string => {
  switch (region) {
    case "NA": return "US";
    case "KR": return "KR";
    case "EU": return "EU";
    default: return "CN";
  }
};

export function AccountInitDialog({ open, onClose, onDone, updateAccount }: Props) {
  const [currentStep, setCurrentStep] = useState<InitStep>("input_nickname");
  const [completedSteps, setCompletedSteps] = useState<Set<InitStep>>(new Set());
  const [accountId, setAccountId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [authMode, setAuthMode] = useState<"bnet" | "token">("token");
  const [region, setRegion] = useState<"CN" | "KR" | "NA" | "EU">("CN");
  const [token, setToken] = useState("");
  const [language, setLanguage] = useState("zhCN");
  const [voicelanguage, setVoicelanguage] = useState("zhCN");
  const [nicknameLocked, setNicknameLocked] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Token wizard state
  const [tokenWizard, setTokenWizard] = useState<TokenWizardStep>("token_nick");
  const [tokenGuideLoading, setTokenGuideLoading] = useState(false);

  const cancelledRef = useRef(false);
  const accountIdRef = useRef("");

  const { createAccount, collectSnapshot } = useAccounts();
  const { config } = useGlobalConfig();

  const markDone = (step: InitStep) => setCompletedSteps(prev => new Set([...prev, step]));

  useEffect(() => {
    if (open) {
      setCurrentStep("input_nickname");
      setCompletedSteps(new Set());
      if (updateAccount) {
        setAccountId(updateAccount.id);
        accountIdRef.current = updateAccount.id;
        setNickname(updateAccount.display_name || updateAccount.id);
        setAuthMode("token");
        let initialRegion: "CN" | "KR" | "NA" | "EU" = "CN";
        if (updateAccount.region === "Global") {
          initialRegion = "KR";
        } else if (["CN", "KR", "NA", "EU"].includes(updateAccount.region as string)) {
          initialRegion = updateAccount.region as "CN" | "KR" | "NA" | "EU";
        }
        setRegion(initialRegion);
        setToken("");
        setNicknameLocked(true);
        setTokenWizard("token_guide");
      } else {
        setAccountId("");
        accountIdRef.current = "";
        setNickname("");
        setAuthMode("token");
        setRegion("CN");
        setToken("");
        setLanguage("zhCN");
        setVoicelanguage("zhCN");
        setNicknameLocked(false);
        setTokenWizard("token_nick");
      }
      setShowGuide(false);
      setTokenGuideLoading(false);
      cancelledRef.current = false;
    }
  }, [open, updateAccount]);

  useEffect(() => {
    if (!open || !config || !nicknameLocked || currentStep !== "input_nickname") return;
    runInit();
  }, [open, nicknameLocked]);

  // Auto-trigger browser launch when entering token guide step
  useEffect(() => {
    if (tokenWizard !== "token_guide" || showGuide) return;
    tokenOpenGuide();
  }, [tokenWizard]);

  useEffect(() => {
    if (currentStep !== "done") return;
    const timer = setTimeout(() => {
      onDone(accountId);
      onClose();
    }, 1500);
    return () => clearTimeout(timer);
  }, [currentStep]);

  const handleCancel = async () => {
    cancelledRef.current = true;
    setError("已取消初始化流程");
    const id = accountIdRef.current;

    try {
      await invoke("kill_bnet_processes").catch(() => {});
      if (config?.auto_close_browser && config && config.browser_type) {
        await invoke("kill_browser_processes", { browserType: config.browser_type }).catch(() => {});
      }
      if (id) {
        await invoke("delete_account", { accountId: id }).catch(() => {});
      }
    } catch (e) {
      console.error("Cancel cleanup failed:", e);
    }

    setCurrentStep("input_nickname");
    setNicknameLocked(false);
    setCompletedSteps(new Set());
    setAccountId("");
    accountIdRef.current = "";
  };

  const handleClose = () => {
    if (currentStep !== "done" && currentStep !== "input_nickname" && tokenWizard !== "token_nick") {
      handleCancel();
    }
    onClose();
  };

  const runInit = async () => {
    setError(null);
    const shouldAutoClose = config?.auto_close_browser ?? false;
    if (cancelledRef.current) return;

    try {
      setCurrentStep("creating");
      let id = "";
      try {
        if (cancelledRef.current) return;
        id = (await createAccount(nickname.trim(), authMode, region, undefined, language || undefined, voicelanguage || undefined)) ?? "";
        if (!id) throw new Error("创建账号失败");
        accountIdRef.current = id;
        setAccountId(id);
        markDone("creating");
      } catch (e) {
        if (cancelledRef.current) return;
        setError(String(e));
        return;
      }

      if (config!.browser_path && config!.browser_type) {
        if (cancelledRef.current) return;
        setCurrentStep("browser_setup");
        try {
          await invoke("launch_browser_for_account", {
            browserPath: config!.browser_path,
            accountId: id,
          });
          if (cancelledRef.current) return;
          markDone("browser_setup");
          setCurrentStep("browser_launch");
          markDone("browser_launch");
          await sleep(1500);
        } catch (e) {
          if (cancelledRef.current) return;
          markDone("browser_setup");
          markDone("browser_launch");
          showToast("warning", `浏览器启动失败（不影响核心功能）: ${e}`);
        }
      } else {
        markDone("browser_setup");
        markDone("browser_launch");
      }

      if (cancelledRef.current) return;
      setCurrentStep("launching_bnet");
      try {
        await invoke("clear_auth_registry");
        await invoke("launch_configured_battle_net");
        if (cancelledRef.current) {
          await invoke("kill_bnet_processes").catch(() => {});
          return;
        }
        await invoke("bring_bnet_to_foreground").catch(() => {});
        markDone("launching_bnet");
      } catch (e) {
        if (cancelledRef.current) return;
        setError("启动战网失败: " + String(e));
        return;
      }

      if (cancelledRef.current) return;
      setCurrentStep("waiting_login");
      let loggedIn = false;
      for (let i = 0; i < 120; i++) {
        if (cancelledRef.current) {
          await invoke("kill_bnet_processes").catch(() => {});
          return;
        }
        await sleep(1000);
        if (cancelledRef.current) {
          await invoke("kill_bnet_processes").catch(() => {});
          return;
        }
        try {
          if (await invoke<boolean>("check_bnet_logged_in")) {
            loggedIn = true;
            break;
          }
        } catch {}
      }
      if (!loggedIn) {
        if (cancelledRef.current) return;
        setError("等待登录超时（120秒），请确认已登录战网后重试");
        return;
      }
      markDone("waiting_login");

      if (cancelledRef.current) return;
      setCurrentStep("collecting");
      try {
        if (!id) return;
        await collectSnapshot(id);
        if (cancelledRef.current) return;
        markDone("collecting");
        setCurrentStep("done");
        showToast("success", "账号 " + nickname.trim() + " 初始化完成！");
      } catch (e) {
        if (cancelledRef.current) return;
        setError("采集快照失败: " + String(e));
      }
    } finally {
      if (shouldAutoClose && config && config.browser_type) {
        await invoke("kill_browser_processes", { browserType: config.browser_type }).catch(() => {});
      }
    }
  };

  // ── Token wizard handlers ──

  const tokenStepNickNext = () => {
    if (!nickname.trim()) { setError("请输入昵称"); return; }
    setError(null);
    setTokenWizard("token_settings");
  };

  const tokenStepSettingsNext = () => {
    setError(null);
    setTokenWizard("token_auth");
  };

  const tokenStepAuthNext = () => {
    if (authMode === "bnet") {
      // Bnet mode: lock and proceed to old flow
      handleConfirmNickname();
    } else {
      setTokenWizard("token_guide");
    }
  };

  const handleConfirmNickname = () => {
    const trimmed = nickname.trim();
    if (!trimmed) { setError("请输入昵称"); return; }
    setError(null);
    setNickname(trimmed);
    markDone("input_nickname");
    setNicknameLocked(true);
  };

  const tokenOpenGuide = async () => {
    setTokenGuideLoading(true);
    setError(null);
    try {
      let id = accountIdRef.current;
      if (!id) {
        const newId = await createAccount(nickname.trim(), "token", region, undefined, language || undefined, voicelanguage || undefined);
        if (!newId) throw new Error("创建账号失败");
        accountIdRef.current = newId;
        setAccountId(newId);
        id = newId;
      }
      setAccountId(id);

      if (config?.browser_path && config?.browser_type) {
        try {
          await invoke("launch_browser_for_account", {
            browserPath: config!.browser_path,
            accountId: id,
          });
          const tokenUrl = getTokenUrl(region);
          await invoke("open_url_in_browser", {
            browserPath: config!.browser_path,
            accountId: id,
            url: tokenUrl,
          }).catch(() => {});
          await sleep(1200);
          await invoke("bring_self_to_foreground").catch(() => {});
        } catch (e) {
          showToast("warning", `浏览器启动失败（不影响核心功能）: ${e}`);
        }
      }
      setShowGuide(true);
    } catch (e) {
      if (cancelledRef.current) return;
      setError(String(e));
    } finally {
      setTokenGuideLoading(false);
    }
  };

  const handleGuideClose = () => {
    setShowGuide(false);
    setTokenWizard("token_paste");
  };

  const handleOpenTokenWeb = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const tokenUrl = getTokenUrl(region);
    try {
      const { open: openUrl } = await import("@tauri-apps/plugin-shell");
      await openUrl(tokenUrl);
    } catch (err) {
      console.error("无法打开网页:", err);
      showToast("error", "打开外部浏览器失败，请手动网页打开。");
    }
  };

  const tokenStepPasteNext = async () => {
    if (!token.trim()) { setError("请粘贴 Token"); return; }
    setError(null);
    const id = accountIdRef.current;
    if (id) {
      try {
        await invoke("update_account_meta", {
          accountId: id,
          token: token.trim() || null,
          region,
          language,
          voicelanguage,
        });
      } catch (e) {
        showToast("error", `更新账号配置失败: ${e}`);
        return;
      }
    }
    onDone(id);
    onClose();
    if (updateAccount) {
      showToast("success", "Token 已更新！");
    } else {
      showToast("success", "Token 账号 " + nickname.trim() + " 初始化完成！");
    }
  };

  // ── Render ──

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="初始化新账号"
      width="max-w-md"
      footer={
        currentStep === "done" ? (
          <Button variant="primary" size="sm" onClick={() => { onDone(accountId); onClose(); }}>完成</Button>
        ) : (currentStep !== "input_nickname" || tokenWizard !== "token_nick") ? (
          <Button variant="secondary" size="sm" onClick={handleCancel}>取消</Button>
        ) : null
      }
    >
      {/* ═══════════ Token Wizard Flow ═══════════ */}
      {!nicknameLocked && (
        <div className="mb-3 flex flex-col gap-3">
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className={tokenWizard === "token_nick" ? "text-accent font-bold" : ""}>1.昵称</span>
            <span>→</span>
            <span className={tokenWizard === "token_settings" ? "text-accent font-bold" : ""}>2.设置</span>
            <span>→</span>
            <span className={tokenWizard === "token_auth" ? "text-accent font-bold" : ""}>3.模式</span>
            <span>→</span>
            <span className={tokenWizard === "token_guide" ? "text-accent font-bold" : ""}>4.获取Token</span>
            <span>→</span>
            <span className={tokenWizard === "token_paste" ? "text-accent font-bold" : ""}>5.粘贴Token</span>
          </div>

          {/* Step 1: Nickname */}
          {tokenWizard === "token_nick" && (
            <>
              <div>
                <p className="text-md text-text-secondary mb-1.5">设置昵称（用于本地标识）</p>
                <Input
                  value={nickname}
                  onChange={e => { setNickname(e.target.value); setError(null); }}
                  placeholder="例如：主号、小号1"
                  autoFocus
                />
              </div>
              <Button variant="primary" size="sm" onClick={tokenStepNickNext}>下一步</Button>
            </>
          )}

          {/* Step 2: Settings — sliders for region/language/voice */}
          {tokenWizard === "token_settings" && (
            <>
              <div className="flex flex-col gap-4">
                {/* Region buttons */}
                <div>
                  <p className="text-sm text-text-secondary mb-1.5">区服</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(["CN", "KR", "NA", "EU"] as const).map(r => (
                      <button
                        key={r}
                        onClick={() => {
                          setRegion(r);
                          if (r === "CN") {
                            setLanguage("zhCN");
                            setVoicelanguage("zhCN");
                          } else if (r === "KR") {
                            setLanguage("zhTW");
                            setVoicelanguage("zhTW");
                          } else {
                            setLanguage("enUS");
                            setVoicelanguage("enUS");
                          }
                        }}
                        className={`py-2 px-1.5 rounded-xl text-xs font-medium transition-all duration-200 ${
                          region === r
                            ? "bg-accent text-white shadow-sm scale-[1.03]"
                            : "bg-surface-hover text-text-secondary hover:bg-surface-active"
                        }`}
                      >
                        {r === "CN" && "国服"}
                        {r === "KR" && "亚服"}
                        {r === "NA" && "美服"}
                        {r === "EU" && "欧服"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Language buttons */}
                <div>
                  <p className="text-sm text-text-secondary mb-1.5">界面语言</p>
                  <div className="flex gap-2">
                    {([
                      { v: "zhCN", label: "简体中文" },
                      { v: "zhTW", label: "繁体中文" },
                      { v: "enUS", label: "English" },
                    ]).map(l => (
                      <button
                        key={l.v}
                        onClick={() => setLanguage(l.v)}
                        className={`flex-1 py-2.5 px-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                          language === l.v
                            ? "bg-accent text-white shadow-sm scale-[1.03]"
                            : "bg-surface-hover text-text-secondary hover:bg-surface-active"
                        }`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Voice language buttons */}
                <div>
                  <p className="text-sm text-text-secondary mb-1.5">配音语言</p>
                  <div className="flex gap-2">
                    {([
                      { v: "zhCN", label: "简体中文" },
                      { v: "zhTW", label: "繁体中文" },
                      { v: "enUS", label: "English" },
                    ]).map(vl => (
                      <button
                        key={vl.v}
                        onClick={() => setVoicelanguage(vl.v)}
                        className={`flex-1 py-2.5 px-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                          voicelanguage === vl.v
                            ? "bg-accent text-white shadow-sm scale-[1.03]"
                            : "bg-surface-hover text-text-secondary hover:bg-surface-active"
                        }`}
                      >
                        {vl.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <Button variant="primary" size="sm" onClick={tokenStepSettingsNext}>下一步</Button>
            </>
          )}

          {/* Step 3: Auth mode */}
          {tokenWizard === "token_auth" && (
            <>
              <p className="text-md text-text-secondary mb-1.5">选择认证模式</p>
              <div className="flex flex-col gap-2">
                <label
                  className="flex items-center gap-2 cursor-pointer p-3 rounded-xl border border-accent/30 bg-surface-hover"
                  title="优点：无需战网客户端，零秒启动，长期有效。缺点：需要战网账号（非网易账号）；若通过网易注册的战网号，可能需要用手机号设置战网密码才能登录网页获取 Token。"
                >
                  <input type="radio" checked={authMode === "token"} onChange={() => { setAuthMode("token"); setError(null); }} className="accent-accent" />
                  <span className="text-md">✨ 网页 Token 认证（推荐·免战网）</span>
                </label>
                <label
                  className="flex items-center gap-2 cursor-pointer p-3 rounded-xl border border-border-default"
                  title="优点：配置简单，仅需网易账号，无需战网账号。缺点：启动较慢（约 10-20s），需经过战网客户端；授权有效期一个月，容易触发 Token 过期需重新登录。"
                >
                  <input type="radio" checked={authMode === "bnet"} onChange={() => { setAuthMode("bnet"); setError(null); }} className="accent-accent" />
                  <span className="text-md">战网客户端认证（需要通过战网启动）</span>
                </label>
              </div>
              <Button variant="primary" size="sm" onClick={tokenStepAuthNext}>下一步</Button>
            </>
          )}

          {/* Step 4: Guide (browser auto-launches) */}
          {tokenWizard === "token_guide" && !showGuide && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-accent">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">正在启动独立浏览器配置并打开登录页面...</span>
              </div>
              {tokenGuideLoading && (
                <p className="text-xs text-text-muted">浏览器启动后，请在新打开的登录页中获取 Token，软件将自动弹出指引图</p>
              )}
              {!tokenGuideLoading && (
                <Button variant="primary" size="sm" onClick={tokenOpenGuide}>重新尝试打开浏览器</Button>
              )}
            </div>
          )}

          {/* Step 5: Paste token */}
          {tokenWizard === "token_paste" && (
            <>
              <div>
                <p className="text-md text-text-secondary mb-1.5">粘贴 Token</p>
                <Input value={token} onChange={e => {
                  let val = e.target.value;
                  const match = val.match(/([A-Z]{2,3}-[A-Za-z0-9]+-[A-Za-z0-9]+)/i);
                  if (match) val = match[1];
                  setToken(val);
                  setError(null);
                }} placeholder={
                  region === "CN"
                    ? "格式: CN-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxx"
                    : `格式: ${getTokenPrefix(region)}-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxx`
                } autoFocus />
              </div>
              <Button variant="primary" size="sm" onClick={tokenStepPasteNext} disabled={!token.trim()}>确认完成</Button>
            </>
          )}
        </div>
      )}

      {/* ═══════════ Old bnet flow (unchanged) ═══════════ */}
      {nicknameLocked && authMode === "bnet" && (
        <div className="relative pl-1">
          <div className="absolute left-[17px] top-3 bottom-3 w-px"
            style={{ background: "var(--border-default)" }} />
          <div className="space-y-0.5">
            {bnetSteps.filter(s => s.id !== "input_nickname").map(s => {
              const done = completedSteps.has(s.id);
              const active = s.id === currentStep;
              return (
                <div key={s.id} className="relative flex items-center gap-3.5 py-2">
                  <div className={"shrink-0 w-[34px] h-[34px] rounded-full flex items-center justify-center z-10 transition-all duration-300 " + (
                    done ? "bg-success/10 border-2 border-success/30"
                      : active ? "bg-accent/10 border-2 border-accent/30"
                        : "border border-border-default bg-surface-base"
                  )}>
                    {done ? <Check size={14} className="text-success" />
                      : active ? <Loader2 size={14} className="animate-spin text-accent" />
                        : <Circle size={14} className="text-text-muted/20" />
                    }
                  </div>
                  <div>
                    <p className={"text-md font-medium transition-colors " + (
                      done ? "text-success" : active ? "text-text-primary" : "text-text-muted"
                    )}>{s.label}</p>
                    {s.desc && active && <p className="text-xs text-text-muted mt-0.5">{s.desc}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════ Error ═══════════ */}
      {error && (
        <div className="mt-3 p-3 rounded-xl text-md text-error"
          style={{ background: "rgba(224,96,96,0.08)", border: "1px solid rgba(224,96,96,0.15)" }}>
          {error}
        </div>
      )}

      {/* ═══════════ BIG Guide Overlay (Portal to body) ═══════════ */}
      {showGuide && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(18,24,34,0.38)] backdrop-blur-[5px]" onClick={(e) => { e.stopPropagation(); handleGuideClose(); }}>
          <div className="relative bg-surface-elevated rounded-modal p-6 max-w-3xl w-[95vw] mx-4 shadow-elevated border border-border-default" onClick={e => e.stopPropagation()}>
            <p className="text-xl font-bold text-text-primary mb-4 text-center">🔍 请在浏览器中按指引复制 Token</p>
            <img src="/token-copy-guide.png" alt="Token 获取指引" className="w-full rounded-xl border border-border-default" style={{ maxHeight: "80vh", objectFit: "contain" }} />
            <p className="text-sm text-text-muted mt-4 text-center">复制完成后关闭此弹窗，在下一步粘贴 Token</p>
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" size="sm" className="flex-1" onClick={handleOpenTokenWeb}>
                手动打开token网页
              </Button>
              <Button variant="primary" size="sm" className="flex-1" onClick={(e) => { e.stopPropagation(); handleGuideClose(); }}>
                已成功复制token
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </Modal>
  );
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
