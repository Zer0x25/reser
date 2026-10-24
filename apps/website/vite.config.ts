import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    proxy: { "/api": "http://localhost:3001" },
  },
});
