import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The app lives in app/ but shares the repo's public/ (so staticFile assets and
// uploaded logos resolve) and imports the Remotion components from ../src.
export default defineConfig({
  plugins: [react()],
  root: "app",
  publicDir: path.resolve(__dirname, "public"),
  server: {
    port: 5173,
    fs: { allow: [path.resolve(__dirname)] },
    proxy: {
      "/api": "http://localhost:3001",
      "/out": "http://localhost:3001",
    },
  },
});
