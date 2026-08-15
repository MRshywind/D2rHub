import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { RuneDropEntry } from "./types";

const RUNE_NAMES: string[] = [
  "艾尔", "艾德", "特尔", "那夫", "爱斯", "伊司", "塔尔", "拉尔",
  "欧特", "书尔", "安姆", "索尔", "夏", "多尔", "海尔",
  "艾欧", "卢姆", "科", "法尔", "蓝姆", "普尔", "乌姆",
  "马尔", "伊斯特", "古尔", "伐克斯", "欧姆", "罗",
  "瑟", "贝", "乔", "查姆", "萨德",
];

/// 方言别名 → 标准名（让前端也能识别 OCR 的多种写法）
const RUNE_ALIASES: Record<string, string> = {
  "提尔": "特尔",
  "奈夫": "那夫",
  "图尔": "书尔",
  "沙伊": "夏",
  "兰姆": "蓝姆",
  "玛尔": "马尔",
  "扎哈": "乔",
  "佐德": "萨德",
  "伊斯": "伊司",
  "伊司特": "伊斯特",
  "艾斯": "爱斯",
  "埃欧": "艾欧",
};

/// 获取符文编号（1-based，与数组索引对应），支持别名
export function getRuneNumber(name: string): number {
  const standard = RUNE_ALIASES[name] || name;
  return RUNE_NAMES.indexOf(standard) + 1;
}

/// 获取符文显示名称：#N 符文名
export function getRuneDisplayName(name: string): string {
  const n = getRuneNumber(name);
  return n > 0 ? `${name}#${n}` : name;
}

/// 是否为高级符文（#24 伊斯特 及以上）
export function isHighRune(runeNumber: number): boolean {
  return runeNumber >= 24;
}



function matchRune(text: string): string | null {
  const sanitized = text.trim().toLowerCase();

  // 合并所有候选项（标准名+别名），按长度降序避免短名抢占长名
  const candidates: { key: string; name: string }[] = [];
  for (const rune of RUNE_NAMES) {
    candidates.push({ key: rune, name: rune });
  }
  for (const [alias, standard] of Object.entries(RUNE_ALIASES)) {
    candidates.push({ key: alias, name: standard });
  }
  candidates.sort((a, b) => b.key.length - a.key.length);

  for (const { key, name } of candidates) {
    if (sanitized.includes(key)) return name;
  }
  return null;
}

/// 单次符文掉落（前端追踪用，非持久化）
export interface DropEntry {
  runeName: string;
  runeNameEn: string | null;
  runeNumber: number;
  screenshotPath: string | null;  // 仅 #24+ 有值
}

/// 主城名称列表（硬编码备份，与 Rust 端 MAIN_CITY_NAME_SET 保持一致）
const MAIN_CITY_NAMES: Set<string> = new Set([
  "侠盗营地", "哈洛加斯", "库拉斯特海港", "库拉斯特港口",
  "流亡者营地", "混沌界要塞", "混沌要塞", "群魔堡垒", "萝格营地", "鲁高因",
]);

/// 菜单界面名称（用于 end 回退）
const MENU_STATE_NAMES: Set<string> = new Set(["角色选择界面", "游戏大厅"]);

interface PhaseConfig {
  start: string[];
  middle: string[];
  end: string[];
}

interface StatsState {
  // ── 当前场景 ──
  currentScene: string;
  lastCombatScene: string;

  // ── 计时器 ──
  isTiming: boolean;
  timerStart: number | null;
  elapsedMs: number;

  // ── 暂停 ──
  isPaused: boolean;
  pausedAtMs: number;

  // ── 计时模式 ──
  timingMode: "full_clear" | "single_scene" | "start_middle_end";
  phaseConfig: PhaseConfig;
  targetReached: boolean;

  // ── 数据库历史平均耗时和总场次（当前场景）──
  dbAvgTime: number | null;
  dbTotalRuns: number | null;

  // ── 本次启动各场景刷图场次 ──
  sessionRuns: Record<string, number>;

  // ── 累计掉落（悬浮窗展示，跨场景不清空）──
  currentDrops: DropEntry[];
  // ── 当前单次场景掉落（每次 startTimer 重置，仅用于数据库存储）──
  currentRunDrops: DropEntry[];

  // ── 角色昵称 ──
  characterName: string;

  // ── Actions ──
  setCharacterName: (name: string) => void;
  startTimer: () => void;
  stopTimerAndSave: () => Promise<void>;
  tick: () => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  stopTimer: () => Promise<void>;
  loadTimingConfig: (cfg?: { ocr_timing_mode?: string; ocr_phase_config_json?: string }) => void;
  processOcrSceneText: (item: { text: string; is_town?: boolean; is_menu?: boolean }) => Promise<void>;
  /// 处理通道B 的 OCR 掉落结果（接收预匹配的符文数据）
  processOcrDrop: (item: {
    text: string;
    rune_number?: number | null;
    screenshot_path?: string | null;
    rune_name_en?: string | null;
  }) => void;
  fetchDbStats: (sceneName: string) => Promise<void>;
  removeCurrentDrop: (index: number) => void;
}

export const useStats = create<StatsState>((set, get) => ({
  currentScene: "等待识别...",
  lastCombatScene: "",
  isTiming: false,
  timerStart: null,
  elapsedMs: 0,
  isPaused: false,
  pausedAtMs: 0,
  timingMode: "full_clear",
  phaseConfig: { start: [], middle: [], end: [] },
  targetReached: false,
  dbAvgTime: null,
  dbTotalRuns: null,
  sessionRuns: {},
  currentDrops: [],
  currentRunDrops: [],
  characterName: "",

  setCharacterName: (name) => set({ characterName: name }),

  startTimer: () => {
    set({ isTiming: true, timerStart: Date.now(), elapsedMs: 0, currentRunDrops: [] });
  },

  stopTimerAndSave: async () => {
    const { timerStart, currentScene, characterName, currentRunDrops } = get();
    if (!timerStart) return;

    const elapsed = Date.now() - timerStart;
    const seconds = Math.round(elapsed / 100) / 10;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const absoluteTime = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}/${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    // 仅使用当前单次场景的掉落（非累计），发送到后端存储
    const dropsPayload: RuneDropEntry[] = currentRunDrops.map((d) => ({
      rune_number: d.runeNumber,
      rune_name: d.runeName,
      rune_name_en: d.runeNameEn || null,
      screenshot_path: d.screenshotPath || null,
    }));

    try {
      if (import.meta.env.VITE_ENABLE_OCR !== "false") {
        await invoke("save_scene_record", {
          record: {
            absolute_time: absoluteTime,
            character_name: characterName || "未知角色",
            scene_name: currentScene,
            timer_seconds: seconds,
            drops: dropsPayload,
          },
        });
      }

      // 记录保存成功后，增加当前场景的本次启动场次
      const currentSessionRuns = get().sessionRuns[currentScene] || 0;
      set({
        sessionRuns: {
          ...get().sessionRuns,
          [currentScene]: currentSessionRuns + 1,
        },
      });
    } catch (e) {
      console.error("保存场景记录失败:", e);
    }

    // 重置计时器，保留累计掉落（跨场景持续显示），清空本轮掉落
    set({ isTiming: false, timerStart: null, elapsedMs: 0, currentRunDrops: [] });
  },

  tick: () => {
    const { isTiming, isPaused, timerStart } = get();
    if (!isTiming || !timerStart || isPaused) return;
    set({ elapsedMs: Date.now() - timerStart });
  },

  pauseTimer: () => {
    const { isTiming, elapsedMs } = get();
    if (!isTiming) return;
    set({ isPaused: true, pausedAtMs: elapsedMs });
  },

  resumeTimer: () => {
    const { isPaused, pausedAtMs } = get();
    if (!isPaused) return;
    set({
      isPaused: false,
      timerStart: Date.now() - pausedAtMs,
    });
  },

  stopTimer: async () => {
    await get().stopTimerAndSave();
    set({ isPaused: false, pausedAtMs: 0, targetReached: false });
  },

  loadTimingConfig: (cfg?: { ocr_timing_mode?: string; ocr_phase_config_json?: string }) => {
    if (!cfg) return;
    const mode = (cfg.ocr_timing_mode || "full_clear") as StatsState["timingMode"];
    let phaseConfig: PhaseConfig = { start: [], middle: [], end: [] };
    if (cfg.ocr_phase_config_json) {
      try {
        const parsed = JSON.parse(cfg.ocr_phase_config_json);
        if (parsed && typeof parsed === "object") {
          phaseConfig = {
            start: Array.isArray(parsed.start) ? parsed.start : [],
            middle: Array.isArray(parsed.middle) ? parsed.middle : [],
            end: Array.isArray(parsed.end) ? parsed.end : [],
          };
        }
      } catch { /* keep defaults */ }
    }
    set({ timingMode: mode, phaseConfig });
  },

  fetchDbStats: async (sceneName: string) => {
    if (!sceneName || sceneName === "等待识别...") return;
    if (import.meta.env.VITE_ENABLE_OCR === "false") return;
    try {
      const stats: { avg_time: number, total_runs: number } | null = await invoke("get_scene_stats", { sceneName });
      // 竞态校验：如果当前场景已变（如已回城），丢弃迟到的历史数据
      if (get().currentScene !== sceneName) return;
      if (stats) {
        set({
          dbAvgTime: Math.round(stats.avg_time * 10) / 10,
          dbTotalRuns: stats.total_runs,
        });
      } else {
        set({ dbAvgTime: null, dbTotalRuns: null });
      }
    } catch {
      if (get().currentScene === sceneName) {
        set({ dbAvgTime: null, dbTotalRuns: null });
      }
    }
  },

  processOcrSceneText: async (item) => {
    let normalized = item.text.trim();
    if (!normalized) return;

    // 清理场景名称：删除"进入"前缀及多余空白
    normalized = normalized.replace(/^进入\s*/, "").trim();
    if (!normalized) return;

    const { isTiming, timingMode, phaseConfig } = get();
    const isTown = item.is_town || false;
    const isMenu = item.is_menu || false;

    // ── 辅助函数 ──
    const isStartZone = (name: string): boolean => {
      if (phaseConfig.start.length > 0) return phaseConfig.start.includes(name);
      return MAIN_CITY_NAMES.has(name);
    };
    const isMiddleZone = (name: string): boolean => {
      if (phaseConfig.middle.length > 0) return phaseConfig.middle.includes(name);
      return false;
    };
    const isEndZone = (name: string): boolean => {
      if (phaseConfig.end.length > 0) return phaseConfig.end.includes(name);
      return MAIN_CITY_NAMES.has(name) || MENU_STATE_NAMES.has(name);
    };

    if (timingMode === "full_clear") {
      // ── 通刷模式（现有逻辑不变）──
      if (isTown) {
        if (isTiming) {
          await get().stopTimerAndSave();
        }
        set({ currentScene: normalized, lastCombatScene: "", dbAvgTime: null, dbTotalRuns: null });
      } else {
        if (isTiming) {
          if (normalized !== get().currentScene) {
            await get().stopTimerAndSave();
            set({ currentScene: normalized, lastCombatScene: normalized });
            get().startTimer();
            get().fetchDbStats(normalized);
          }
        } else {
          set({ currentScene: normalized, lastCombatScene: normalized });
          get().startTimer();
          get().fetchDbStats(normalized);
        }
      }
    } else if (timingMode === "single_scene") {
      // ── 单场景模式：主城→目标场景→主城/菜单为一轮 ──
      if (isTown || isMenu) {
        if (isTiming) {
          // 保存时使用 lastCombatScene（最后一个战斗场景名）
          const sceneToSave = get().lastCombatScene || normalized;
          // 临时替换 currentScene 以保存正确的场景名
          const prev = get().currentScene;
          set({ currentScene: sceneToSave });
          await get().stopTimerAndSave();
          set({ currentScene: prev });
          set({ targetReached: false });
        }
        set({ currentScene: normalized, lastCombatScene: "", dbAvgTime: null, dbTotalRuns: null });
      } else {
        // 战斗场景
        if (isTiming) {
          // 检查是否为中间标记场景
          if (isMiddleZone(normalized)) {
            set({ targetReached: true });
          }
          // 更新场景名但不重新计时，继续累计
          set({ currentScene: normalized, lastCombatScene: normalized });
        } else {
          // 离开主城/菜单 → 开始计时
          set({ currentScene: normalized, lastCombatScene: normalized });
          get().startTimer();
          get().fetchDbStats(normalized);
        }
      }
    } else if (timingMode === "start_middle_end") {
      // ── 阶段标记模式：自定义 start/middle/end ──
      if (isEndZone(normalized)) {
        if (isTiming) {
          const sceneToSave = get().lastCombatScene || normalized;
          const prev = get().currentScene;
          set({ currentScene: sceneToSave });
          await get().stopTimerAndSave();
          set({ currentScene: prev });
          set({ targetReached: false });
        }
        set({ currentScene: normalized, lastCombatScene: "", dbAvgTime: null, dbTotalRuns: null });
      } else if (isMiddleZone(normalized)) {
        if (!isTiming) {
          get().startTimer();
        }
        set({ targetReached: true, currentScene: normalized, lastCombatScene: normalized });
        get().fetchDbStats(normalized);
      } else if (isStartZone(normalized)) {
        if (isTiming) {
          // 意外提前回到起点 → 结束
          await get().stopTimerAndSave();
          set({ targetReached: false });
        }
        set({ currentScene: normalized, lastCombatScene: "", dbAvgTime: null, dbTotalRuns: null });
      } else {
        // 其他战斗场景
        if (isTiming) {
          set({ currentScene: normalized, lastCombatScene: normalized });
        } else {
          set({ currentScene: normalized, lastCombatScene: normalized });
          get().startTimer();
          get().fetchDbStats(normalized);
        }
      }
    }
  },

  processOcrDrop: (item) => {
    const { text, rune_number, screenshot_path, rune_name_en } = item;

    // 优先使用后端匹配的符文编号，其次前端本地匹配
    let runeName: string;
    let runeNumber: number;

    if (rune_number && rune_number >= 1 && rune_number <= 33 && RUNE_NAMES[rune_number - 1]) {
      runeNumber = rune_number;
      runeName = RUNE_NAMES[rune_number - 1];
    } else {
      const matched = matchRune(text);
      if (!matched) return;
      runeName = matched;
      runeNumber = getRuneNumber(matched);
    }

    // 每个 OCR 结果 = 一次独立掉落（支持同一符文多次掉落，各有截图）
    const newDrop: DropEntry = {
      runeName,
      runeNameEn: rune_name_en || null,
      runeNumber,
      screenshotPath: screenshot_path || null,
    };

    set({
      currentDrops: [...get().currentDrops, newDrop],
      currentRunDrops: [...get().currentRunDrops, newDrop],
    });
  },

  removeCurrentDrop: (index) => {
    set({
      currentDrops: get().currentDrops.filter((_, idx) => idx !== index),
    });
  },
}));
