import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AccountMeta } from "./types";
import { showToast } from "../components/ui/Toast";

interface AccountsState {
  accounts: AccountMeta[];
  loading: boolean;
  error: string | null;

  loadAccounts: () => Promise<void>;
  createAccount: (nickname: string, authMode?: string, region?: string, token?: string, language?: string, voicelanguage?: string) => Promise<string | null>;
  deleteAccount: (id: string) => Promise<void>;
  renameAccount: (id: string, newName: string) => Promise<void>;
  updateAccountMods: (id: string, activeMod: string, modList: string[]) => Promise<void>;
  repairRegistry: (id: string) => Promise<void>;
  repairAllRegistries: () => Promise<void>;
  reinitializeAccount: (id: string) => Promise<void>;
  collectSnapshot: (id: string) => Promise<void>;
  updateAccount: (account: AccountMeta) => void;
  reorderAccounts: (orderedIds: string[]) => Promise<void>;
  markSettingsCustomized: (id: string) => Promise<void>;
}

export const useAccounts = create<AccountsState>((set, get) => ({
  accounts: [],
  loading: false,
  error: null,

  loadAccounts: async () => {
    set({ loading: true, error: null });
    try {
      const accounts = await invoke<AccountMeta[]>("list_accounts");
      set({ accounts, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  createAccount: async (nickname: string, authMode?: string, region?: string, token?: string, language?: string, voicelanguage?: string) => {
    try {
      const id = await invoke<string>("create_account", {
        nickname,
        authMode: authMode || null,
        region: region || null,
        token: token || null,
        language: language || null,
        voicelanguage: voicelanguage || null
      });
      await get().loadAccounts();
      return id;
    } catch (e) {
      set({ error: String(e) });
      showToast("error", `创建账号失败: ${e}`);
      return null;
    }
  },

  deleteAccount: async (id: string) => {
    try {
      await invoke("delete_account", { accountId: id });
      await get().loadAccounts();
    } catch (e) {
      set({ error: String(e) });
      showToast("error", `删除账号失败: ${e}`);
    }
  },

  renameAccount: async (id: string, newName: string) => {
    try {
      await invoke("rename_account", { accountId: id, newName });
      await get().loadAccounts();
    } catch (e) {
      set({ error: String(e) });
      showToast("error", `重命名失败: ${e}`);
    }
  },

  updateAccountMods: async (id: string, activeMod: string, modList: string[]) => {
    try {
      await invoke("update_account_mods", { accountId: id, activeMod, modList });
      await get().loadAccounts();
    } catch (e) {
      set({ error: String(e) });
      showToast("error", `保存 Mod 参数失败: ${e}`);
    }
  },

  repairRegistry: async (id: string) => {
    try {
      await invoke("repair_account_registry", { accountId: id });
      showToast("success", "注册表修复成功");
    } catch (e) {
      set({ error: String(e) });
      showToast("error", `修复注册表失败: ${e}`);
    }
  },

  repairAllRegistries: async () => {
    try {
      await invoke("repair_all_registries");
      showToast("success", "所有账号注册表已修复成功");
    } catch (e) {
      set({ error: String(e) });
      showToast("error", `修复全部注册表失败: ${e}`);
    }
  },

  reinitializeAccount: async (id: string) => {
    // 使用自身 store 的 error 状态标记进行中操作，不再耦合 useLaunch
    set({ error: null });
    try {
      await invoke("reinitialize_account", { accountId: id });
      await get().loadAccounts();
    } catch (e) {
      set({ error: String(e) });
      showToast("error", `重置账号失败: ${e}`);
      throw e;
    }
  },

  collectSnapshot: async (id: string) => {
    try {
      await invoke("collect_account_snapshot", { accountId: id });
      await get().loadAccounts();
    } catch (e) {
      set({ error: String(e) });
      showToast("error", `采集快照失败: ${e}`);
      throw e;
    }
  },

  updateAccount: (account: AccountMeta) => {
    set((state) => ({
      accounts: state.accounts.map((a) =>
        a.id === account.id ? account : a
      ),
    }));
  },

  reorderAccounts: async (orderedIds: string[]) => {
    try {
      await invoke("reorder_accounts", { orderedIds });
      await get().loadAccounts();
    } catch (e) {
      set({ error: String(e) });
      showToast("error", `排序失败: ${e}`);
    }
  },

  markSettingsCustomized: async (id: string) => {
    try {
      await invoke("mark_settings_customized", { accountId: id });
      await get().loadAccounts();
    } catch (e) {
      console.error("mark_settings_customized failed:", e);
    }
  },
}));
