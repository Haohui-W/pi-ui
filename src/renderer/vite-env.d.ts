/// <reference types="vite/client" />

import type { PiBridge } from "../shared/ipc";

declare global {
  interface Window {
    pi: PiBridge;
  }
}
