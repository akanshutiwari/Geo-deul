// Must be the first import: web3.js / anchor / the ephemeral-rollups-sdk touch
// Buffer at module-evaluation time.
import { Buffer } from "buffer";

(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer ??= Buffer;
