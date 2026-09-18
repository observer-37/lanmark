/**
 * vault store 守卫测试（review 修复回归）：
 * - openNote/closeNote 保存失败必须中止（未保存编辑不丢铁律，与 deleteNode 一致）
 * - 快速连开时慢响应不得覆盖新状态（activePath 与 content 错位 → A 内容写进 B 的文件）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  readNote: vi.fn(),
  writeNote: vi.fn(),
  recents: vi.fn(),
  favorites: vi.fn(),
  tree: vi.fn(),
}));

vi.mock("../lib/vault", () => ({
  vault: {
    status: vi.fn(),
    readNote: m.readNote,
    writeNote: m.writeNote,
    tree: m.tree,
    recents: m.recents,
    favorites: m.favorites,
    reindex: vi.fn(),
    pickAndSet: vi.fn(),
    setPath: vi.fn(),
    setPathWithCreate: vi.fn(),
    createNote: vi.fn(),
    createFolder: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    toggleFavorite: vi.fn(),
    search: vi.fn(),
  },
  remapPath: (active: string | null, from: string, to: string): string | null =>
    active === from
      ? to
      : active && active.startsWith(from + "/")
        ? to + active.slice(from.length)
        : active,
}));
vi.mock("../lib/sync", () => ({ vaultPicker: { pickFolder: vi.fn() } }));

import { useVaultStore } from "./vault";

const { readNote, writeNote, recents, favorites, tree } = m;

function baseState() {
  useVaultStore.setState({
    status: "ready",
    vaultPath: "/v",
    tree: [],
    activePath: null,
    content: "",
    dirty: false,
    savedAt: null,
    editorMode: "wysiwyg",
    renamingPath: null,
    searchQuery: "",
    searchResults: [],
    recents: [],
    favorites: [],
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  baseState();
  readNote.mockImplementation((p: string) => Promise.resolve({ content: `内容${p}`, title: p }));
  writeNote.mockResolvedValue(undefined);
  recents.mockResolvedValue([]);
  favorites.mockResolvedValue([]);
  tree.mockResolvedValue([]);
});

describe("openNote/closeNote 守卫", () => {
  it("openNote 前保存失败 → 中止切换，未保存内容保留", async () => {
    useVaultStore.setState({ activePath: "a.md", content: "未保存的旧内容", dirty: true });
    writeNote.mockRejectedValueOnce(new Error("磁盘满"));

    await useVaultStore.getState().openNote("b.md");

    const s = useVaultStore.getState();
    expect(s.activePath).toBe("a.md");
    expect(s.content).toBe("未保存的旧内容");
    expect(s.dirty).toBe(true);
    expect(s.error).toBeTruthy();
    expect(readNote).not.toHaveBeenCalled();
  });

  it("closeNote 前保存失败 → 保留笔记打开，内容不丢", async () => {
    useVaultStore.setState({ activePath: "a.md", content: "未保存", dirty: true });
    writeNote.mockRejectedValueOnce(new Error("权限不足"));

    await useVaultStore.getState().closeNote();

    const s = useVaultStore.getState();
    expect(s.activePath).toBe("a.md");
    expect(s.content).toBe("未保存");
    expect(s.dirty).toBe(true);
  });

  it("保存成功后正常切换", async () => {
    useVaultStore.setState({ activePath: "a.md", content: "改", dirty: true });

    await useVaultStore.getState().openNote("b.md");

    const s = useVaultStore.getState();
    expect(s.activePath).toBe("b.md");
    expect(s.dirty).toBe(false);
    expect(writeNote).toHaveBeenCalledTimes(1);
  });

  it("快速连开：慢响应的 a.md 不得覆盖后点的 b.md", async () => {
    let resolveA: (v: { content: string; title: string }) => void = () => {};
    readNote.mockImplementation((p: string) =>
      p === "a.md"
        ? new Promise((r) => {
            resolveA = r;
          })
        : Promise.resolve({ content: "B内容", title: "b.md" }),
    );

    const p1 = useVaultStore.getState().openNote("a.md");
    const p2 = useVaultStore.getState().openNote("b.md");
    await p2;
    expect(useVaultStore.getState().activePath).toBe("b.md");

    // a.md 的慢响应此刻才返回 → 必须被丢弃
    resolveA({ content: "A内容", title: "a.md" });
    await p1;

    const s = useVaultStore.getState();
    expect(s.activePath).toBe("b.md");
    expect(s.content).toBe("B内容");
  });
});
