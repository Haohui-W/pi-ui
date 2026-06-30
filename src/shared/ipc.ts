import type { RpcCommand, RpcEnvelope } from "./rpc";

export interface StartRpcOptions {
  cwd?: string;
  continueRecent?: boolean;
  piCommand?: string;
}

export interface PiBridge {
  startRpc(options?: StartRpcOptions): Promise<void>;
  sendRpc(command: RpcCommand): Promise<void>;
  stopRpc(): Promise<void>;
  onRpc(listener: (event: RpcEnvelope) => void): () => void;
  onRpcError(listener: (message: string) => void): () => void;
  onRpcStderr(listener: (message: string) => void): () => void;
  onRpcExit(listener: (code: number | null) => void): () => void;
}
