import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
    // Milkdown 是 ESM 包，需要内联处理
    server: {
      deps: {
        inline: [/@milkdown/, /unified/, /remark/, /unist/, /mdast/, /hast/, /micromark/],
      },
    },
  },
});
