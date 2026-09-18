import { create } from "zustand";
import {
  sync,
  vaultPicker,
  isAndroid,
  type Discovered,
  type ServerProfile,
  type SyncPairingInfo,
  type SyncReport,
} from "../lib/sync";

/**
 * M2 同步状态。手机端：展示服务器/配对码；桌面端：发现/配对/手动同步。
 * M2 无自动周期同步（M3），同步由「立即同步」按钮触发。
 */
interface SyncStore {
  /** 手机端配对信息 */
  pairing: SyncPairingInfo | null;
  /** 桌面端已配对服务器 */
  servers: ServerProfile[];
  /** mDNS 发现中 / 结果 */
  discovering: boolean;
  discovered: Discovered[];
  /** 同步进行中 */
  syncing: boolean;
  /** 最近一次同步报告 */
  lastReport: SyncReport | null;
  error: string | null;

  refreshPairing: () => Promise<void>;
  refreshServers: () => Promise<void>;
  discover: () => Promise<void>;
  pair: (url: string, code: string) => Promise<boolean>;
  removeServer: (id: string) => Promise<void>;
  syncNow: (id: string) => Promise<void>;
  clearError: () => void;

  /** Android 专项 */
  hasAllFilesAccess: boolean;
  checkAllFilesAccess: () => Promise<boolean>;
  requestAllFilesAccess: () => Promise<void>;
  pickFolder: () => Promise<string | null>;
}

export const useSyncStore = create<SyncStore>((set, get) => ({
  pairing: null,
  servers: [],
  discovering: false,
  discovered: [],
  syncing: false,
  lastReport: null,
  error: null,

  refreshPairing: async () => {
    try {
      set({ pairing: await sync.pairingInfo() });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  refreshServers: async () => {
    try {
      set({ servers: await sync.servers() });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  discover: async () => {
    set({ discovering: true });
    try {
      const found = await sync.discover();
      set({ discovered: found });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ discovering: false });
    }
  },

  pair: async (url, code) => {
    try {
      await sync.pair(url, code);
      await get().refreshServers();
      set({ lastReport: null });
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },

  removeServer: async (id) => {
    try {
      await sync.serverRemove(id);
      await get().refreshServers();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  syncNow: async (id) => {
    set({ syncing: true, error: null });
    try {
      const report = await sync.syncNow(id);
      set({ lastReport: report });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ syncing: false });
    }
  },

  clearError: () => set({ error: null }),

  hasAllFilesAccess: false,

  checkAllFilesAccess: async () => {
    if (!isAndroid()) return true;
    try {
      const ok = await vaultPicker.hasAllFilesAccess();
      set({ hasAllFilesAccess: ok });
      return ok;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },

  requestAllFilesAccess: async () => {
    try {
      await vaultPicker.requestAllFilesAccess();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  pickFolder: async () => {
    try {
      return await vaultPicker.pickFolder();
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
}));
