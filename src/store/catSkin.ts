import { create } from "zustand";

export type CatSkinKey = "original" | "mage";

interface CatSkinState {
  currentSkin: CatSkinKey;
  unlockedSkins: CatSkinKey[];
  setSkin: (skin: CatSkinKey) => void;
  unlockSkin: (skin: CatSkinKey) => void;
  isUnlocked: (skin: CatSkinKey) => boolean;
  reload: () => void;
}

const SKIN_STORAGE_KEY = "d2rhub-cat-current-skin";
const UNLOCKED_STORAGE_KEY = "d2rhub-cat-unlocked-skins";

function loadCurrentSkin(): CatSkinKey {
  try {
    const saved = localStorage.getItem(SKIN_STORAGE_KEY) as CatSkinKey | null;
    if (saved && ["original", "mage"].includes(saved)) {
      return saved;
    }
  } catch {}
  return "original";
}

function loadUnlockedSkins(): CatSkinKey[] {
  try {
    const saved = localStorage.getItem(UNLOCKED_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as CatSkinKey[];
      if (Array.isArray(parsed) && parsed.includes("original")) {
        return parsed;
      }
    }
  } catch {}
  return ["original"];
}

export const useCatSkin = create<CatSkinState>((set, get) => ({
  currentSkin: loadCurrentSkin(),
  unlockedSkins: loadUnlockedSkins(),
  setSkin: (skin) => {
    if (get().unlockedSkins.includes(skin)) {
      try {
        localStorage.setItem(SKIN_STORAGE_KEY, skin);
      } catch {}
      set({ currentSkin: skin });
    }
  },
  unlockSkin: (skin) => {
    const current = get().unlockedSkins;
    if (!current.includes(skin)) {
      const updated = [...current, skin];
      try {
        localStorage.setItem(UNLOCKED_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      set({ unlockedSkins: updated });
    }
  },
  isUnlocked: (skin) => {
    return get().unlockedSkins.includes(skin);
  },
  reload: () => {
    set({
      currentSkin: loadCurrentSkin(),
      unlockedSkins: loadUnlockedSkins(),
    });
  }
}));

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === SKIN_STORAGE_KEY || e.key === UNLOCKED_STORAGE_KEY) {
      useCatSkin.getState().reload();
    }
  });
}
