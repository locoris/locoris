import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"]
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.vitest.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true
  }
});
