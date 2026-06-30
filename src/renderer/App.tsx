import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import type { RpcAgentMessage, RpcCommand, RpcEnvelope, RpcResponse, RpcSessionState, SessionStats } from "../shared/rpc";

type ViewRole = "system" | "user" | "assistant" | "tool" | "error";

interface ViewMessage {
  id: string;
  role: ViewRole;
  text: string;
  status?: "streaming" | "complete" | "error";
}

interface ViewTool {
  id: string;
  name: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  endedAt?: number;
}

interface Snapshot {
  cwd: string;
  state?: RpcSessionState;
  stats?: SessionStats;
}

const initialSnapshot: Snapshot = { cwd: "" };

export function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [tools, setTools] = useState<ViewTool[]>([]);
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanups = [
      window.pi.onRpc((event) => applyRpcEnvelope(event, { setSnapshot, setMessages, setTools, setBusy })),
      window.pi.onRpcError((message) => pushError(setMessages, message)),
      window.pi.onRpcStderr((message) => {
        if (message.trim()) pushError(setMessages, message);
      }),
      window.pi.onRpcExit(() => setBusy(false)),
    ];

    void startSession(false);
    return () => {
      for (const cleanup of cleanups) cleanup();
      void window.pi.stopRpc();
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const canSend = prompt.trim().length > 0 && !starting;
  const activeTools = useMemo(() => tools.filter((tool) => !tool.endedAt).length, [tools]);

  async function startSession(continueRecent: boolean): Promise<void> {
    setStarting(true);
    try {
      const nextCwd = cwd.trim();
      await window.pi.startRpc({ cwd: nextCwd || undefined, continueRecent });
      setSnapshot({ cwd: nextCwd || "Current app directory" });
      send({ type: "get_state" });
      send({ type: "get_session_stats" });
      pushSystem(setMessages, "pi RPC session started");
    } catch (error) {
      pushError(setMessages, formatError(error));
    } finally {
      setStarting(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    setPrompt("");
    send({ type: "prompt", message: text });
  }

  function send(command: RpcCommand): void {
    void window.pi.sendRpc({ id: command.id ?? createId("rpc"), ...command }).catch((error) => {
      pushError(setMessages, formatError(error));
    });
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">pi</div>
          <div>
            <h1>Pi Agent</h1>
            <p>RPC desktop workbench</p>
          </div>
        </div>

        <section className="control-block">
          <label htmlFor="cwd">Working directory</label>
          <input id="cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="Use app directory" />
          <div className="button-row">
            <button type="button" onClick={() => startSession(false)} disabled={starting}>
              New
            </button>
            <button type="button" onClick={() => startSession(true)} disabled={starting}>
              Continue
            </button>
          </div>
        </section>

        <SessionMeta snapshot={snapshot} />
      </aside>

      <section className="conversation">
        <header className="topbar">
          <div>
            <span className={busy ? "status busy" : "status"} />
            {busy ? "Agent running" : "Ready"}
          </div>
          <button type="button" onClick={() => send({ type: "abort" })} disabled={!busy}>
            Abort
          </button>
        </header>

        <div className="messages" ref={listRef}>
          {messages.length === 0 ? (
            <div className="empty">
              <h2>Start a pi RPC session</h2>
              <p>The desktop app talks to pi through JSONL RPC and keeps the agent engine out of the UI process.</p>
            </div>
          ) : (
            messages.map((message) => <MessageBlock key={message.id} message={message} />)
          )}
        </div>

        <form className="composer" onSubmit={submit}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSend) {
                void submit(event);
              }
            }}
            placeholder="Ask pi to inspect, edit, or explain the current project..."
          />
          <button type="submit" disabled={!canSend}>
            Send
          </button>
        </form>
      </section>

      <aside className="tools">
        <header>
          <h2>Tools</h2>
          <span>{activeTools} running</span>
        </header>
        <div className="tool-list">
          {tools.length === 0 ? (
            <p className="muted">Tool calls will appear here.</p>
          ) : (
            tools.map((tool) => <ToolRow key={tool.id} tool={tool} />)
          )}
        </div>
      </aside>
    </main>
  );
}

function SessionMeta({ snapshot }: { snapshot: Snapshot }): React.JSX.Element {
  const model = snapshot.state?.model;
  const stats = snapshot.stats;
  return (
    <section className="meta">
      <div>
        <span>Model</span>
        <strong>{model ? `${model.provider ?? "provider"}/${model.id ?? model.name ?? "model"}` : "Not selected"}</strong>
      </div>
      <div>
        <span>Thinking</span>
        <strong>{snapshot.state?.thinkingLevel ?? "off"}</strong>
      </div>
      <div>
        <span>Session</span>
        <strong>{snapshot.state?.sessionId ? snapshot.state.sessionId.slice(0, 8) : "none"}</strong>
      </div>
      <div>
        <span>Tokens</span>
        <strong>{stats ? `in ${formatCount(stats.tokens.input)} / out ${formatCount(stats.tokens.output)}` : "0"}</strong>
      </div>
      <div>
        <span>Context</span>
        <strong>
          {stats?.contextUsage?.percent == null
            ? "unknown"
            : `${stats.contextUsage.percent.toFixed(1)}% / ${formatCount(stats.contextUsage.contextWindow)}`}
        </strong>
      </div>
    </section>
  );
}

function MessageBlock({ message }: { message: ViewMessage }): React.JSX.Element {
  return (
    <article className={`message ${message.role}`}>
      <header>{message.role}</header>
      <pre>{message.text || (message.status === "streaming" ? "..." : "")}</pre>
    </article>
  );
}

function ToolRow({ tool }: { tool: ViewTool }): React.JSX.Element {
  const state = tool.endedAt ? (tool.isError ? "error" : "done") : "running";
  return (
    <article className={`tool-card ${state}`}>
      <div>
        <strong>{tool.name}</strong>
        <span>{state}</span>
      </div>
      <pre>{JSON.stringify(tool.result ?? tool.args ?? {}, null, 2)}</pre>
    </article>
  );
}

function applyRpcEnvelope(
  event: RpcEnvelope,
  setters: {
    setSnapshot: (value: Snapshot | ((prev: Snapshot) => Snapshot)) => void;
    setMessages: (value: ViewMessage[] | ((prev: ViewMessage[]) => ViewMessage[])) => void;
    setTools: (value: ViewTool[] | ((prev: ViewTool[]) => ViewTool[])) => void;
    setBusy: (value: boolean) => void;
  }
): void {
  if (isRpcResponse(event)) {
    applyResponse(event, setters);
    return;
  }
  if (event.type === "agent_start") setters.setBusy(true);
  if (event.type === "agent_end") {
    setters.setBusy(false);
    void window.pi.sendRpc({ id: createId("stats"), type: "get_session_stats" });
  }
  if (event.type === "message_start" && isRpcAgentMessage(event.message)) {
    const message = projectMessage(event.message);
    if (message) setters.setMessages((prev) => [...prev, message]);
  }
  if (event.type === "message_update") {
    const delta =
      isRecord(event.assistantMessageEvent) && typeof event.assistantMessageEvent.delta === "string"
        ? event.assistantMessageEvent.delta
        : undefined;
    if (typeof delta === "string") {
      setters.setMessages((prev) => appendToLastStreamingAssistant(prev, delta));
    }
  }
  if (event.type === "message_end" && isRpcAgentMessage(event.message) && event.message.role === "assistant") {
    setters.setMessages((prev) => markLastAssistantComplete(prev));
  }
  if (event.type === "tool_execution_start" && typeof event.toolCallId === "string" && typeof event.toolName === "string") {
    const id = event.toolCallId;
    const name = event.toolName;
    setters.setTools((prev) => [{ id, name, args: event.args }, ...prev]);
  }
  if (event.type === "tool_execution_update" && typeof event.toolCallId === "string") {
    setters.setTools((prev) =>
      prev.map((tool) => (tool.id === event.toolCallId ? { ...tool, result: event.partialResult } : tool))
    );
  }
  if (event.type === "tool_execution_end" && typeof event.toolCallId === "string") {
    setters.setTools((prev) =>
      prev.map((tool) =>
        tool.id === event.toolCallId
          ? { ...tool, result: event.result, isError: event.isError === true, endedAt: Date.now() }
          : tool
      )
    );
  }
}

function applyResponse(
  response: RpcResponse,
  setters: {
    setSnapshot: (value: Snapshot | ((prev: Snapshot) => Snapshot)) => void;
    setMessages: (value: ViewMessage[] | ((prev: ViewMessage[]) => ViewMessage[])) => void;
  }
): void {
  if (!response.success) {
    pushError(setters.setMessages, response.error ?? `RPC command failed: ${response.command}`);
    return;
  }
  if (response.command === "get_state") {
    setters.setSnapshot((prev) => ({ ...prev, state: response.data as unknown as RpcSessionState }));
  }
  if (response.command === "get_session_stats") {
    setters.setSnapshot((prev) => ({ ...prev, stats: response.data as unknown as SessionStats }));
  }
}

function projectMessage(message: RpcAgentMessage): ViewMessage | undefined {
  if (message.role === "user") {
    return { id: createId("user"), role: "user", text: extractContentText(message.content), status: "complete" };
  }
  if (message.role === "assistant") {
    return { id: createId("assistant"), role: "assistant", text: extractContentText(message.content), status: "streaming" };
  }
  if (message.role === "toolResult") {
    return { id: createId("tool"), role: "tool", text: extractContentText(message.content), status: "complete" };
  }
  return undefined;
}

function isRpcResponse(event: RpcEnvelope): event is RpcResponse {
  return event.type === "response" && "command" in event && "success" in event;
}

function isRpcAgentMessage(value: unknown): value is RpcAgentMessage {
  return isRecord(value) && typeof value.role === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendToLastStreamingAssistant(messages: ViewMessage[], delta: string): ViewMessage[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant" && message.status === "streaming") {
      return messages.map((item, itemIndex) => (itemIndex === index ? { ...item, text: item.text + delta } : item));
    }
  }
  return [...messages, { id: createId("assistant"), role: "assistant", text: delta, status: "streaming" }];
}

function markLastAssistantComplete(messages: ViewMessage[]): ViewMessage[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant") {
      return messages.map((item, itemIndex) => (itemIndex === index ? { ...item, status: "complete" } : item));
    }
  }
  return messages;
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && "type" in part) {
        const typed = part as { type: string; text?: string; thinking?: string; name?: string; arguments?: unknown };
        if (typed.type === "text") return typed.text ?? "";
        if (typed.type === "thinking") return typed.thinking ? `[thinking]\n${typed.thinking}` : "";
        if (typed.type === "toolCall") return `\n[tool] ${typed.name ?? "unknown"} ${JSON.stringify(typed.arguments ?? {})}`;
      }
      return "";
    })
    .join("");
}

function pushSystem(setMessages: (value: ViewMessage[] | ((prev: ViewMessage[]) => ViewMessage[])) => void, text: string): void {
  setMessages((prev) => [...prev, { id: createId("system"), role: "system", text, status: "complete" }]);
}

function pushError(setMessages: (value: ViewMessage[] | ((prev: ViewMessage[]) => ViewMessage[])) => void, text: string): void {
  setMessages((prev) => [...prev, { id: createId("error"), role: "error", text, status: "error" }]);
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1000000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1000000).toFixed(1)}M`;
}
