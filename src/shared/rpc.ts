export type RpcJson = null | boolean | number | string | RpcJson[] | { [key: string]: RpcJson };

export interface RpcCommand {
  id?: string;
  type: string;
  [key: string]: RpcJson | undefined;
}

export interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: RpcJson;
  error?: string;
}

export interface RpcSessionState {
  model?: { provider?: string; id?: string; name?: string; contextWindow?: number } | null;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  messageCount?: number;
  pendingMessageCount?: number;
}

export interface SessionStats {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
}

export type RpcEnvelope =
  | RpcResponse
  | { type: "message_start"; message: RpcAgentMessage }
  | { type: "message_update"; assistantMessageEvent?: { type?: string; delta?: string }; [key: string]: RpcJson | undefined }
  | { type: "message_end"; message: RpcAgentMessage }
  | { type: "agent_start" | "agent_end"; [key: string]: RpcJson | undefined }
  | {
      type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
      toolCallId: string;
      toolName: string;
      args?: RpcJson;
      partialResult?: RpcJson;
      result?: RpcJson;
      isError?: boolean;
    }
  | { type: "extension_ui_request"; id: string; method: string; [key: string]: RpcJson | undefined }
  | { type: string; [key: string]: RpcJson | undefined };

export interface RpcAgentMessage {
  role: string;
  content?: RpcJson;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}
