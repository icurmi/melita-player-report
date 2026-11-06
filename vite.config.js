import { defineConfig } from "vite";
import { resolve } from "path";
export default defineConfig({
  build: { rollupOptions: { input: {
    main: resolve(__dirname, "index.html"),
    confirm: resolve(__dirname, "confirm.html"),
    report: resolve(__dirname, "report.html"),
  } } },
});
