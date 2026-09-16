import { describe, it, expect } from "vitest";
import { remapPath, parentDir } from "./vault";

describe("remapPath（目录改名/移动后重映射 activePath）", () => {
  it("条目本身被改名", () => {
    expect(remapPath("工作", "工作", "研发")).toBe("研发");
  });

  it("子笔记跟随目录改名", () => {
    expect(remapPath("工作/会议纪要.md", "工作", "研发")).toBe("研发/会议纪要.md");
    expect(remapPath("工作/a/b/深.md", "工作", "研发")).toBe("研发/a/b/深.md");
  });

  it("无关路径不受影响", () => {
    expect(remapPath("生活.md", "工作", "研发")).toBe("生活.md");
    expect(remapPath("工作2/笔记.md", "工作", "研发")).toBe("工作2/笔记.md");
  });

  it("null 安全", () => {
    expect(remapPath(null, "工作", "研发")).toBeNull();
  });
});

describe("parentDir", () => {
  it("根级笔记 → 空串", () => {
    expect(parentDir("笔记.md")).toBe("");
  });
  it("多级路径", () => {
    expect(parentDir("a/b/c/笔记.md")).toBe("a/b/c");
  });
});
