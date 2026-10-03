import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    fs: {
      allow: ["../.."],
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: ["index.html", "probe.html"],
    },
  },
});
