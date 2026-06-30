import type { AgentSessionEvent, SessionStats } from "@earendil-works/pi-coding-agent";

export interface SessionSnapshot {
  sessionId?: string;
  sessionFile?: string;
  cwd: string;
  model?: string;
  thinkingLevel?: string;
  isStreaming: boolean;
  stats?: SessionStats;
}

export type PiEvent =
  | { type: "snapshot"; snapshot: SessionSnapshot }
  | { type: "agent-event"; event: AgentSessionEvent }
  | { type: "busy"; value: boolean }
  | { type: "error"; message: string };

export interface StartSessionOptions {
  cwd?: string;
  continueRecent?: boolean;
}

export interface PiBridge {
  startSession(options?: StartSessionOptions): Promise<SessionSnapshot>;
  sendPrompt(prompt: string): Promise<void>;
  abort(): Promise<void>;
  disposeSession(): Promise<void>;
  onEvent(listener: (event: PiEvent) => void): () => void;
}
