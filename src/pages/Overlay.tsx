import React, { useEffect, useState, useRef } from "react";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { useAccounts } from "../store/accounts";
import { useTheme, syncThemeFromConfig } from "../store/theme";
import { useGlobalConfig, initConfigListener } from "../store/globalConfig";
import { useStats, isHighRune } from "../store/stats";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { useWindowGeometrySave } from "../hooks/useWindowGeometrySave";
import { usePreventDragRegionDoubleClick } from "../hooks/useAppEffects";
import { surfaceOpacityVars } from "../styles/surfaceOpacity";
import { isEnglishLanguage } from "../i18n";
import { translateTerrorZoneAreaName } from "../data/terrorZoneAreaNames";

interface OcrTextItem {
  text: string;
  source: string;
  timestamp: string;
  rune_number?: number | null;
  screenshot_path?: string | null;
  is_town?: boolean;
  rune_name_en?: string | null;
}

interface TerrorZoneImmunity {
  code: string;
  label: string;
  color: string;
}

interface TerrorZoneForecast {
  start_time: number;
  end_time: number;
  display_time: string;
  location_name: string;
  location_detail: string;
  tier_exp: string;
  tier_loot: string;
  immunities: TerrorZoneImmunity[];
}

interface TerrorZoneSnapshot {
  current: TerrorZoneForecast | null;
  next: TerrorZoneForecast | null;
}

type TerrorZoneStatus = "loading" | "ready" | "empty" | "error";
const TERROR_ZONE_COLLAPSED_MIN_HEIGHT = 150;
const TERROR_ZONE_DRAWER_ANIMATION_MS = 180;
const IMMUNITY_EN_LABELS: Record<string, string> = {
  f: "F",
  c: "C",
  l: "L",
  p: "P",
  m: "M",
  ph: "Ph",
};
const IMMUNITY_EN_NAMES: Record<string, string> = {
  f: "Fire",
  c: "Cold",
  l: "Lightning",
  p: "Poison",
  m: "Magic",
  ph: "Physical",
};

function getImmunityTextColor(code: string) {
  return ["l", "p", "m", "ph"].includes(code) ? "#18181b" : "#ffffff";
}

function getImmunityLabel(immunity: TerrorZoneImmunity, useEnglish: boolean) {
  return useEnglish ? (IMMUNITY_EN_LABELS[immunity.code] ?? immunity.code.toUpperCase()) : immunity.label;
}

function getImmunityTitle(immunity: TerrorZoneImmunity, useEnglish: boolean) {
  if (useEnglish) {
    return `Monster is immune to ${IMMUNITY_EN_NAMES[immunity.code] ?? immunity.code.toUpperCase()}`;
  }

  const label = immunity.label;
  return `怪物${label}免疫`;
}

function translateOverlaySceneName(sceneName: string, useEnglish: boolean) {
  if (!useEnglish) return sceneName;
  if (sceneName === "等待识别...") return "Waiting for detection...";
  return translateTerrorZoneAreaName(sceneName, true);
}

function TerrorZoneInfo({
  label,
  zone,
  useEnglish,
}: {
  label: string;
  zone: TerrorZoneForecast;
  useEnglish: boolean;
}) {
  const locationName = translateTerrorZoneAreaName(zone.location_name, useEnglish);
  const locationDetail = translateTerrorZoneAreaName(zone.location_detail, useEnglish);
  const expTierLabel = useEnglish ? "EXP tier" : "经验等级";
  const lootTierLabel = useEnglish ? "Loot tier" : "财富等级";

  return (
    <div className="min-w-0" data-tauri-drag-region>
      <div className="flex items-center justify-between gap-2" data-tauri-drag-region>
        <span className="text-2xs font-semibold text-text-muted" data-tauri-drag-region>
          {label}
        </span>
        <span className="text-2xs font-mono font-semibold text-text-muted tabular-nums" data-tauri-drag-region>
          {zone.display_time}
        </span>
      </div>

      <div
        className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"
        data-tauri-drag-region
      >
        <span
          className="max-w-full shrink-0 truncate text-sm font-semibold leading-tight text-text-primary"
          title={locationDetail}
          data-tauri-drag-region
        >
          {locationName}
        </span>

        <div className="flex shrink-0 items-center gap-1" data-tauri-drag-region>
          {zone.immunities.map((immunity) => (
            <span
              key={immunity.code}
              className="inline-flex h-4 w-4 items-center justify-center rounded-[5px] text-[9px] font-black leading-none"
              style={{
                backgroundColor: immunity.color,
                color: getImmunityTextColor(immunity.code),
                border: "1px solid rgba(0,0,0,0.14)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
              }}
              title={getImmunityTitle(immunity, useEnglish)}
              data-tauri-drag-region
            >
              {getImmunityLabel(immunity, useEnglish)}
            </span>
          ))}
        </div>
      </div>

      <div
        className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs font-semibold text-text-secondary"
        data-tauri-drag-region
      >
        <span className="whitespace-nowrap" data-tauri-drag-region>
          {expTierLabel}:<span className="ml-0.5 text-text-primary">{zone.tier_exp}</span>
        </span>
        <span className="whitespace-nowrap" data-tauri-drag-region>
          {lootTierLabel}:<span className="ml-0.5 text-text-primary">{zone.tier_loot}</span>
        </span>
      </div>
    </div>
  );
}

export function Overlay() {
  const { config, load } = useGlobalConfig();
  const { theme } = useTheme();
  const { accounts, loadAccounts } = useAccounts();
  const stats = useStats();

  const isPollerActive = !!(config?.enable_overlay || config?.ocr_enabled);

  const startupCheckDoneRef = useRef(false);
  const overlayPanelRef = useRef<HTMLDivElement | null>(null);
  const terrorZoneDetailsRef = useRef<HTMLDivElement | null>(null);
  const terrorZoneCollapseTimerRef = useRef<number | null>(null);
  const terrorZoneExpandedHeightRef = useRef<number | null>(null);

  async function getOverlayWindowSize() {
    const win = getCurrentWindow();
    const size = await win.outerSize();
    const scale = await win.scaleFactor();

    return {
      win,
      width: Math.round(size.width / scale),
      height: Math.round(size.height / scale),
    };
  }

  async function setWindowHeightOnce(targetHeight: number) {
    try {
      const { win, width } = await getOverlayWindowSize();
      await win.setSize(new LogicalSize(width, Math.round(targetHeight)));
    } catch (err) {
      console.warn("[Overlay] set window height failed:", err);
    }
  }

  function getTerrorZoneCollapsedHeight() {
    const detailsHeight = terrorZoneDetailsRef.current?.scrollHeight ?? 0;
    const panelHeight = getOverlayPanelHeight();
    return Math.max(TERROR_ZONE_COLLAPSED_MIN_HEIGHT, panelHeight - detailsHeight);
  }

  function clearTerrorZonePanelTimer() {
    if (terrorZoneCollapseTimerRef.current !== null) {
      window.clearTimeout(terrorZoneCollapseTimerRef.current);
      terrorZoneCollapseTimerRef.current = null;
    }
  }

  function getOverlayPanelHeight() {
    return Math.round(overlayPanelRef.current?.getBoundingClientRect().height ?? 0);
  }

  async function expandTerrorZoneDrawer() {
    try {
      const detailsHeight = terrorZoneDetailsRef.current?.scrollHeight ?? 0;
      const currentPanelHeight = getOverlayPanelHeight();
      const nextHeight = terrorZoneExpandedHeightRef.current ?? currentPanelHeight + detailsHeight;

      if (detailsHeight > 0) {
        await setWindowHeightOnce(nextHeight);
      }

      setOverlayPanelHeight(currentPanelHeight || null);
      setTerrorZoneExpanded(true);
      window.requestAnimationFrame(() => {
        setOverlayPanelHeight(nextHeight);
        terrorZoneCollapseTimerRef.current = window.setTimeout(() => {
          terrorZoneCollapseTimerRef.current = null;
          setOverlayPanelHeight(null);
        }, TERROR_ZONE_DRAWER_ANIMATION_MS);
      });
    } catch (err) {
      console.warn("[Overlay] expand terror zone drawer failed:", err);
    }
  }

  async function collapseTerrorZoneDrawer() {
    try {
      const currentPanelHeight = getOverlayPanelHeight();
      if (currentPanelHeight > 0) {
        terrorZoneExpandedHeightRef.current = currentPanelHeight;
        setOverlayPanelHeight(currentPanelHeight);
      }
      const collapsedHeight = getTerrorZoneCollapsedHeight();

      window.requestAnimationFrame(() => {
        setTerrorZoneExpanded(false);
        setOverlayPanelHeight(collapsedHeight);
        terrorZoneCollapseTimerRef.current = window.setTimeout(() => {
          terrorZoneCollapseTimerRef.current = null;
          void setWindowHeightOnce(collapsedHeight);
          setOverlayPanelHeight(null);
        }, TERROR_ZONE_DRAWER_ANIMATION_MS);
      });
    } catch (err) {
      console.warn("[Overlay] collapse terror zone drawer failed:", err);
    }
  }

  function toggleTerrorZoneDrawer() {
    clearTerrorZonePanelTimer();

    if (terrorZoneExpanded) {
      void collapseTerrorZoneDrawer();
    } else {
      void expandTerrorZoneDrawer();
    }
  }

  // Apply font scale on startup from localStorage, then sync from config
  useEffect(() => {
    try {
      const saved = localStorage.getItem("d2rhub-font-scale");
      if (saved && ["small","default","large"].includes(saved)) {
        document.documentElement.dataset.fontScale = saved;
      } else {
        document.documentElement.dataset.fontScale = "default";
      }
    } catch {
      document.documentElement.dataset.fontScale = "default";
    }
  }, []);

  // Sync font scale from config when it loads/changes
  useEffect(() => {
    if (!config?.font_scale) return;
    if (["small","default","large"].includes(config.font_scale)) {
      document.documentElement.dataset.fontScale = config.font_scale;
      try { localStorage.setItem("d2rhub-font-scale", config.font_scale); } catch {}
    }
  }, [config?.font_scale]);

  const [foregroundTitle, setForegroundTitle] = useState("");
  const [terrorZones, setTerrorZones] = useState<TerrorZoneSnapshot>({ current: null, next: null });
  const [terrorZoneStatus, setTerrorZoneStatus] = useState<TerrorZoneStatus>("loading");
  const [overlayPanelHeight, setOverlayPanelHeight] = useState<number | null>(null);
  const [terrorZoneExpanded, setTerrorZoneExpanded] = useState(() => {
    try {
      return localStorage.getItem("d2rhub-terror-zone-expanded") !== "false";
    } catch {
      return true;
    }
  });

  // Sync theme on startup / changes
  useEffect(() => {
    load();
    // Start config listener for live updates from main window
    let unlisten: () => void;
    initConfigListener().then(fn => { unlisten = fn; });
    return () => { if (unlisten!) unlisten(); };
  }, [load]);

  // Sync theme from global config (config as source of truth)
  useEffect(() => {
    if (!config?.theme_overlay) return;
    syncThemeFromConfig(config.theme_overlay);
  }, [config?.theme_overlay]);

  useEffect(() => {
    try {
      localStorage.setItem("d2rhub-terror-zone-expanded", String(terrorZoneExpanded));
    } catch {}
  }, [terrorZoneExpanded]);

  useEffect(() => {
    return () => {
      if (terrorZoneCollapseTimerRef.current !== null) {
        window.clearTimeout(terrorZoneCollapseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isPollerActive) return;

    let cancelled = false;
    let refreshTimer: number | undefined;

    function queueNextLoad(snapshot: TerrorZoneSnapshot | null, fallbackDelayMs = 5 * 60 * 1000) {
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }

      const refreshAt = snapshot?.next?.start_time ?? snapshot?.current?.end_time;
      const delayMs = refreshAt
        ? Math.max(
            15 * 1000,
            Math.min(10 * 60 * 1000, refreshAt * 1000 - Date.now() + 60 * 1000),
          )
        : fallbackDelayMs;

      refreshTimer = window.setTimeout(loadNextTerrorZone, delayMs);
    }

    async function loadNextTerrorZone() {
      try {
        const snapshot = await invoke<TerrorZoneSnapshot>("get_terror_zone_snapshot");
        if (cancelled) return;
        setTerrorZones(snapshot);
        setTerrorZoneStatus(snapshot.current || snapshot.next ? "ready" : "empty");
        queueNextLoad(snapshot, 60 * 1000);
      } catch (err) {
        console.warn("[Overlay] get_terror_zone_snapshot failed:", err);
        if (!cancelled) {
          setTerrorZones({ current: null, next: null });
          setTerrorZoneStatus("error");
          queueNextLoad(null);
        }
      }
    }

    loadNextTerrorZone();
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [isPollerActive]);

  // Set character name from monitored account
  useEffect(() => {
    if (!isPollerActive) return;
    if (config?.ocr_target_account) {
      const target = accounts.find((a) => a.id === config.ocr_target_account);
      if (target) {
        stats.setCharacterName(target.display_name || target.id);
      }
    }
  }, [config?.ocr_target_account, accounts, stats.setCharacterName, isPollerActive]);

  // Restore overlay window geometry on startup
  useEffect(() => {
    (async () => {
      try {
        const saved = await invoke<any>("load_overlay_geometry");
        const win = getCurrentWindow();
        if (saved && saved.x > -32000 && saved.y > -32000 && saved.width > 50 && saved.height > 50) {
          await win.setPosition(new LogicalPosition(saved.x, saved.y));
          await win.setSize(new LogicalSize(saved.width, saved.height));
        } else {
          await win.setPosition(new LogicalPosition(60, 60));
          await win.setSize(new LogicalSize(240, 280));
        }
      } catch {}
    })();
  }, []);

  useWindowGeometrySave("save_overlay_geometry", 50, 50);
  usePreventDragRegionDoubleClick();

  // Config is updated in real-time via the Tauri event listener in globalConfig.ts

  // Load accounts
  useEffect(() => {
    if (!isPollerActive) return;
    loadAccounts();
    const interval = setInterval(loadAccounts, 5000);
    return () => clearInterval(interval);
  }, [loadAccounts, isPollerActive]);

  // 启动时检查已运行的 D2R 窗口，立即更新悬浮窗状态（仅执行一次）
  useEffect(() => {
    if (startupCheckDoneRef.current) return;
    if (!isPollerActive) return;
    if (!config?.ocr_target_account) return;
    (async () => {
      try {
        startupCheckDoneRef.current = true;

        // 刷新账号运行状态（扫描 D2R 窗口匹配账号昵称 → 更新 active_games）
        const matchedIds: string[] = await invoke("refresh_account_running_state");
        if (matchedIds.length > 0) {
          // 等待账号列表加载完成
          await loadAccounts();
        }

        // 如果任一 D2R 窗口标题包含被监控账号的昵称，直接设置为前台标题
        const titles: string[] = await invoke("get_d2r_window_titles");
        if (titles.length > 0 && config?.ocr_target_account) {
          // 使用 getState() 读取最新账号列表，避免将 accounts 加入依赖造成循环
          const latestAccounts = useAccounts.getState().accounts;
          const target = latestAccounts.find((a) => a.id === config.ocr_target_account);
          if (target) {
            const displayName = target.display_name || target.id;
            const match = titles.find((t) =>
              t.toLowerCase().includes(displayName.toLowerCase())
            );
            if (match) {
              setForegroundTitle(match);
            }
          }
        }
      } catch {}
    })();
  }, [config?.ocr_target_account, isPollerActive]);

  // 前台窗口标题轮询
  useEffect(() => {
    if (!isPollerActive) return;
    const poll = async () => {
      try {
        const title = await invoke<string>("get_foreground_window_title");
        setForegroundTitle(title);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [isPollerActive]);

  // ── OCR 数据轮询（场景 + 掉落）──
  useEffect(() => {
    if (!isPollerActive || import.meta.env.VITE_ENABLE_OCR === "false" || !config?.ocr_enabled) return;

    const pollInterval = config.ocr_poll_interval_ms ?? 500;

    const poll = async () => {
      try {
        // Channel A: 场景名称
        const chA = await invoke<OcrTextItem[]>("get_ocr_ch_a_results");
        for (const item of chA) {
          if (item.source === "channel_a" && item.text) {
            await stats.processOcrSceneText(item);
          }
        }

        // Channel B: 掉落文字（符文）— 现在传递完整的预匹配数据
        const chB = await invoke<OcrTextItem[]>("get_ocr_ch_b_results");
        for (const item of chB) {
          if (item.source === "channel_b" && item.text) {
            stats.processOcrDrop({
              text: item.text,
              rune_number: item.rune_number,
              screenshot_path: item.screenshot_path,
              rune_name_en: item.rune_name_en,
            });
          }
        }
      } catch {
        // OCR 未启动时静默忽略
      }
    };

    poll();
    const interval = setInterval(poll, pollInterval);
    return () => clearInterval(interval);
  }, [config?.ocr_enabled, config?.ocr_poll_interval_ms, isPollerActive]);

  // ── 计时器 tick (100ms → 0.1s 精度) ──
  useEffect(() => {
    if (!isPollerActive) return;
    const interval = setInterval(() => {
      stats.tick();
    }, 100);
    return () => clearInterval(interval);
  }, [isPollerActive]);

  // ── 派生数据 ──
  const activeAccounts = accounts.filter((a) => a.is_running);
  const avgTime = stats.dbAvgTime;
  const elapsedDisplay = stats.isTiming
    ? (stats.elapsedMs / 1000).toFixed(1)
    : "0.0";
  const currentTerrorZone = terrorZones.current;
  const nextTerrorZone = terrorZones.next;
  const hasTerrorZoneData = !!(currentTerrorZone || nextTerrorZone);
  const useEnglish = isEnglishLanguage(config?.app_language);
  const currentTerrorZoneLabel = useEnglish ? "Current" : "当前";
  const nextTerrorZoneLabel = useEnglish ? "Next" : "下一个";
  const noActiveAccountLabel = useEnglish ? "No active accounts" : "无活动账号";
  const averageTimeLabel = useEnglish ? "Average" : "平均";
  const totalRunsLabel = useEnglish ? "Total" : "总计";
  const currentSessionRunsLabel = useEnglish ? "This session" : "本次";
  const runUnitLabel = useEnglish ? "runs" : "场";
  const dropsLabel = useEnglish ? "Drops" : "掉落";
  const emptyDropsLabel = useEnglish ? "None" : "暂无";
  const deleteDropTitle = useEnglish ? "Remove from overlay" : "从前端删除";
  const terrorZoneTitle = useEnglish ? "Terror Zone" : "邪恶区域";
  const collapseTerrorZoneTitle = useEnglish ? "Collapse terror zone" : "收起邪恶区域";
  const expandTerrorZoneTitle = useEnglish ? "Expand terror zone" : "展开邪恶区域";
  const terrorZoneSummary = currentTerrorZone
    ? `${currentTerrorZoneLabel} ${translateTerrorZoneAreaName(currentTerrorZone.location_name, useEnglish)}`
    : nextTerrorZone
      ? `${nextTerrorZoneLabel} ${translateTerrorZoneAreaName(nextTerrorZone.location_name, useEnglish)}`
      : terrorZoneStatus === "error"
        ? (useEnglish ? "Forecast unavailable" : "预报暂不可用")
        : terrorZoneStatus === "empty"
          ? (useEnglish ? "Waiting for next forecast" : "等待下一条预报")
          : (useEnglish ? "Syncing" : "同步中");

  return (
    <div
      className="h-screen w-screen overflow-hidden select-none"
      style={{
        ...surfaceOpacityVars(config?.overlay_opacity, theme),
      }}
      data-tauri-drag-region
    >
      <div
        ref={overlayPanelRef}
        className="overlay-window flex w-full flex-col overflow-hidden rounded-xl p-2.5 transition-[height] duration-[180ms] ease-out"
        style={{
          height: overlayPanelHeight === null ? "100%" : overlayPanelHeight,
          border: "1px solid var(--border-default)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
        }}
        data-tauri-drag-region
      >
      {/* ═══════════════════════════════════════════
          1. 账号胶囊（现有）
          ═══════════════════════════════════════════ */}
      <div className="flex flex-wrap gap-1.5">
        {activeAccounts.length > 0 ? (
          activeAccounts.map((a) => {
            const isMonitored =
              config?.ocr_enabled && config?.ocr_target_account === a.id;
            const displayName = a.display_name || a.id;
            const isFocused =
              foregroundTitle.length > 0 &&
              displayName.length > 0 &&
              foregroundTitle.toLowerCase().includes(displayName.toLowerCase());

            const bg = isFocused
              ? "rgba(52,211,153,0.12)"
              : isMonitored
                ? "rgba(200,168,78,0.15)"
                : "var(--surface-hover)";
            const border = isFocused
              ? "1px solid rgba(52,211,153,0.45)"
              : isMonitored
                ? "1px solid rgba(200,168,78,0.3)"
                : "1px solid var(--border-default)";
            const textColor = isFocused
              ? "var(--success)"
              : isMonitored
                ? "var(--accent)"
                : "var(--text-secondary)";
            const dotBg = isFocused
              ? "var(--success)"
              : isMonitored
                ? "var(--accent)"
                : "var(--success)";
            const dotShadow = isFocused
              ? "0 0 6px rgba(52,211,153,0.6)"
              : isMonitored
                ? "0 0 4px rgba(200,168,78,0.5)"
                : "0 0 4px rgba(52,211,153,0.4)";

            let tooltip = "";
            if (useEnglish) {
              if (isFocused && isMonitored) tooltip = "Monitoring window · Focused · Double-click to switch";
              else if (isFocused) tooltip = "Focused · Double-click to switch";
              else if (isMonitored) tooltip = "Monitoring window · Double-click to focus";
              else tooltip = "Double-click to focus window";
            } else if (isFocused && isMonitored) tooltip = "正在监测窗口 · 当前聚焦 · 双击切换";
            else if (isFocused) tooltip = "当前聚焦 · 双击切换";
            else if (isMonitored) tooltip = "正在监测窗口 · 双击聚焦";
            else tooltip = "双击聚焦窗口";

            return (
              <div
                key={a.id}
                className="flex items-center gap-1 px-2 py-[3px] rounded-full text-2xs font-medium
                  cursor-pointer hover:brightness-110 active:scale-95 transition-all duration-150 select-none"
                title={tooltip}
                style={
                  {
                    background: bg,
                    color: textColor,
                    border,
                    WebkitAppRegion: "no-drag",
                  } as React.CSSProperties
                }
                onDoubleClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const ok = await invoke<boolean>("bring_window_by_title_to_front", {
                      windowTitle: displayName,
                    });
                    if (!ok) {
                      console.warn("[Overlay] bring_window_by_title_to_front returned false for", displayName);
                    }
                  } catch (err) {
                    console.error("[Overlay] bring_window_by_title_to_front failed:", err);
                  }
                }}
              >
                {isMonitored && (
                  <Eye
                    size={10}
                    className="shrink-0"
                    style={{ opacity: isFocused ? 1 : 0.85 }}
                  />
                )}
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: dotBg, boxShadow: dotShadow }}
                />
                {displayName}
              </div>
            );
          })
        ) : (
          <div className="text-xs text-text-muted italic">{noActiveAccountLabel}</div>
        )}
      </div>

      {/* ═══════════════════════════════════════════
          2. 数据统计 — 计时器核心视觉
          ═══════════════════════════════════════════ */}
      <div className="flex flex-col gap-2 mt-2.5 flex-1 min-h-0" data-tauri-drag-region>

        {import.meta.env.VITE_ENABLE_OCR !== "false" && (
          <>
        {/* 场景名称 — 右上角小字 */}
        <div className="flex justify-end px-1" data-tauri-drag-region>
          <span
            className="text-sm font-medium text-text-secondary truncate max-w-[180px] text-right"
            data-tauri-drag-region
          >
            {translateOverlaySceneName(stats.currentScene, useEnglish)}
          </span>
        </div>

        {/* 计时器 — 大字居中，无背景容器 */}
        <div className="flex flex-col items-center py-1.5" data-tauri-drag-region>
          <span
            className="text-xl font-mono font-bold tabular-nums leading-none select-none"
            style={{
              color: stats.isTiming ? "var(--success)" : "var(--text-muted)",
              textShadow: stats.isTiming ? "0 0 20px rgba(76,175,80,0.3)" : "none",
              transition: "color 0.3s, text-shadow 0.3s",
            }}
            data-tauri-drag-region
          >
            {elapsedDisplay}
          </span>
          <span
            className="text-xs font-mono mt-0.5 select-none"
            style={{
              color: stats.isTiming ? "var(--success)" : "var(--text-muted)",
              opacity: 0.6,
            }}
            data-tauri-drag-region
          >
            SEC
          </span>
          {avgTime !== null && (
            <div className="flex flex-col items-center mt-1.5 gap-0.5">
              <span
                className="text-xs font-medium select-none"
                style={{ color: "var(--accent)" }}
                data-tauri-drag-region
              >
                {averageTimeLabel} {avgTime.toFixed(1)}s
              </span>
              <span
                className="text-2xs font-medium select-none"
                style={{ color: "var(--text-secondary)", opacity: 0.8 }}
                data-tauri-drag-region
              >
                {totalRunsLabel} {stats.dbTotalRuns} {runUnitLabel} · {currentSessionRunsLabel} {stats.sessionRuns[stats.currentScene] || 0} {runUnitLabel}
              </span>
            </div>
          )}
        </div>

        {/* 分隔线 */}
        <div
          className="w-full shrink-0"
          style={{ height: 1, background: "var(--border-default)" }}
          data-tauri-drag-region
        />

        {/* 符文掉落 — 瀑布流 + 滑条 */}
        <div className="flex flex-col gap-1 flex-1 min-h-0" data-tauri-drag-region>
          <span className="text-2xs font-medium text-text-muted px-1" data-tauri-drag-region>
            {dropsLabel}
            {stats.currentDrops.length > 0 && (
              <span className="text-accent ml-0.5">({stats.currentDrops.length})</span>
            )}
          </span>

          <div
            className="flex flex-wrap gap-1 pr-1 overflow-y-auto content-start"
            style={{ flex: 1, scrollbarWidth: "thin" }}
            data-tauri-drag-region
          >
            {stats.currentDrops.length > 0 ? (
              stats.currentDrops.map((drop, i) => ({ drop, index: i })).reverse().map(({ drop, index }) => {
                const high = isHighRune(drop.runeNumber);
                return (
                  <span
                    key={`${drop.runeName}-${index}`}
                    className="relative inline-flex items-center pl-1.5 pr-4 py-0.5 rounded-md text-2xs font-medium
                      transition-all duration-200 hover:brightness-110 group"
                    style={{
                      background: high ? "rgba(255,119,0,0.18)" : "var(--accent-glow)",
                      color: high ? "#ffaa00" : "var(--accent)",
                      border: high
                        ? "1px solid rgba(255,119,0,0.5)"
                        : "1px solid var(--border-strong)",
                      boxShadow: high ? "0 0 10px rgba(255,119,0,0.25)" : "none",
                      WebkitAppRegion: "no-drag",
                    } as React.CSSProperties}
                  >
                    <span>{(useEnglish && drop.runeNameEn ? drop.runeNameEn : drop.runeName)}#{drop.runeNumber}</span>
                    <button
                      className="absolute right-0.5 top-0 bottom-0 flex items-center justify-center w-3 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        stats.removeCurrentDrop(index);
                      }}
                      title={deleteDropTitle}
                    >
                      ×
                    </button>
                  </span>
                );
              })
            ) : (
              <span className="text-2xs text-text-muted italic px-1" data-tauri-drag-region>
                {emptyDropsLabel}
              </span>
            )}
          </div>
        </div>

          </>
        )}
        <div
          className="shrink-0 overflow-hidden rounded-lg px-2 py-1.5 transition-all duration-200"
          style={{
            background:
              "linear-gradient(180deg, rgba(var(--accent-rgb), 0.055), rgba(var(--accent-rgb), 0.025))",
            border: "1px solid var(--border-default)",
          }}
          data-tauri-drag-region
        >
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={(e) => {
              e.stopPropagation();
              toggleTerrorZoneDrawer();
            }}
            title={terrorZoneExpanded ? collapseTerrorZoneTitle : expandTerrorZoneTitle}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <span className="shrink-0 text-2xs font-semibold text-text-muted">
              {terrorZoneTitle}
            </span>
            <span className="min-w-0 flex-1 truncate text-right text-2xs font-semibold text-text-secondary">
              {terrorZoneSummary}
            </span>
            {terrorZoneExpanded ? (
              <ChevronDown size={13} className="shrink-0 text-text-muted" />
            ) : (
              <ChevronUp size={13} className="shrink-0 text-text-muted" />
            )}
          </button>

          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-out ${
              terrorZoneExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
            data-tauri-drag-region
          >
            <div
              ref={terrorZoneDetailsRef}
              className="min-h-0 overflow-hidden"
              data-tauri-drag-region
            >
              {hasTerrorZoneData ? (
                <div className="mt-1.5 flex flex-col gap-1.5" data-tauri-drag-region>
                  {currentTerrorZone && (
                    <TerrorZoneInfo label={currentTerrorZoneLabel} zone={currentTerrorZone} useEnglish={useEnglish} />
                  )}
                  {nextTerrorZone && (
                    <TerrorZoneInfo label={nextTerrorZoneLabel} zone={nextTerrorZone} useEnglish={useEnglish} />
                  )}
                </div>
              ) : (
                <span className="mt-1 block text-2xs font-medium text-text-muted" data-tauri-drag-region>
                  {terrorZoneSummary}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
