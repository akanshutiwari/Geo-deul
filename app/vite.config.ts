import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // the ephemeral-rollups-sdk dynamically imports bs58 inside getAuthToken
    include: ["bs58", "buffer", "@coral-xyz/anchor", "@solana/web3.js", "@magicblock-labs/ephemeral-rollups-sdk", "tweetnacl"],
  },
  define: {
    "process.env": {},
    global: "globalThis",
  },
});
