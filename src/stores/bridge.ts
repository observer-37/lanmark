import { create } from "zustand";

export interface EchoEntry {
  id: string;
  message: string;
  at: string;
}

interface BridgeState {
  /** Rust 事件回推的日志（最新在前，最多 20 条） */
  echoLog: EchoEntry[];
  pushEcho: (entry: Omit<EchoEntry, "id">) => void;
}

export const useBridgeStore = create<BridgeState>((set) => ({
  echoLog: [],
  pushEcho: (entry) =>
    set((state) => ({
      echoLog: [
        { ...entry, id: crypto.randomUUID() },
        ...state.echoLog,
      ].slice(0, 20),
    })),
}));
