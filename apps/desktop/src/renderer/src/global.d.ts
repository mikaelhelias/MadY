import type { MadyBridge } from "../../preload";
import type { AgentBridge } from "./shell/agentBridge";

declare global {
  interface Window {
    mady: MadyBridge;
    /** The typed agent API — present only in the AGENT edition (see __AGENT_API__). */
    madyAgent?: AgentBridge;
  }
  /** Build stamp (version · commit · build time) injected by electron.vite.config.ts. */
  const __MADY_BUILD__: string;
  /** The year the program was built, injected by electron.vite.config.ts. */
  const __MADY_BUILD_YEAR__: number;
  /** True only in the AGENT edition — gates window.madyAgent (compile-time constant). */
  const __AGENT_API__: boolean;
  /** Edition label ("Standard" | "Agent") injected by electron.vite.config.ts. */
  const __MADY_EDITION__: string;
}

export {};
