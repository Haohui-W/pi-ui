import type { RpcCommand, RpcEnvelope } from "./rpc";

export interface StartRpcOptions {
  cwd?: string;
  continueRecent?: boolean;
  sessionPath?: string;
  piCommand?: string;
}

export interface PiSessionSummary {
  id: string;
  path: string;
  cwd: string;
  title: string;
  firstMessage: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  cwdExists: boolean;
}

export interface PiBridge {
  startRpc(options?: StartRpcOptions): Promise<void>;
  sendRpc(command: RpcCommand): Promise<void>;
  stopRpc(): Promise<void>;
  listSessions(): Promise<PiSessionSummary[]>;
  pickFolder(): Promise<string | undefined>;
  onRpc(listener: (event: RpcEnvelope) => void): () => void;
  onRpcError(listener: (message: string) => void): () => void;
  onRpcStderr(listener: (message: string) => void): () => void;
  onRpcExit(listener: (code: number | null) => void): () => void;
}
