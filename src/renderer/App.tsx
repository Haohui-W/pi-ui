import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { PiEvent, SessionSnapshot } from "../shared/ipc";

type SdkMessage = Extract<AgentSessionEvent, { type: "message_start" }>["message"];
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

const initialSnapshot: SessionSnapshot = {
  cwd: "",
  isStreaming: false
};

export function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(initialSnapshot);
  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [tools, setTools] = useState<ViewTool[]>([]);
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = window.pi.onEvent((event) => {
      applyEvent(event, { setSnapshot, setMessages, setTools, setBusy });
    });
    void startSession(false);
    return unsubscribe;
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const canSend = prompt.trim().length > 0 && !starting;
  const activeTools = useMemo(() => tools.filter((tool) => !tool.endedAt).length, [tools]);

  async function startSession(continueRecent: boolean): Promise<void> {
    setStarting(true);
    try {
      const next = await window.pi.startSession({ cwd: cwd.trim() || undefined, continueRecent });
      setSnapshot(next);
      if (!cwd) setCwd(next.cwd);
    } finally {
      setStarting(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    setPrompt("");
    await window.pi.sendPrompt(text);
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">π</div>
          <div>
            <h1>Pi Agent</h1>
            <p>Desktop workbench</p>
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
          <button type="button" onClick={() => window.pi.abort()} disabled={!busy}>
            Abort
          </button>
        </header>

        <div className="messages" ref={listRef}>
          {messages.length === 0 ? (
            <div className="empty">
              <h2>Start a pi session</h2>
              <p>It uses your existing pi auth, settings, skills, context files, and extensions.</p>
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

function SessionMeta({ snapshot }: { snapshot: SessionSnapshot }): React.JSX.Element {
  const stats = snapshot.stats;
  return (
    <section className="meta">
      <div>
        <span>Model</span>
        <strong>{snapshot.model ?? "Not selected"}</strong>
      </div>
      <div>
        <span>Thinking</span>
        <strong>{snapshot.thinkingLevel ?? "off"}</strong>
      </div>
      <div>
        <span>Session</span>
        <strong>{snapshot.sessionId ? snapshot.sessionId.slice(0, 8) : "none"}</strong>
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

function applyEvent(
  event: PiEvent,
  setters: {
    setSnapshot: (value: SessionSnapshot | ((prev: SessionSnapshot) => SessionSnapshot)) => void;
    setMessages: (value: ViewMessage[] | ((prev: ViewMessage[]) => ViewMessage[])) => void;
    setTools: (value: ViewTool[] | ((prev: ViewTool[]) => ViewTool[])) => void;
    setBusy: (value: boolean) => void;
  }
): void {
  if (event.type === "snapshot") setters.setSnapshot(event.snapshot);
  if (event.type === "busy") setters.setBusy(event.value);
  if (event.type === "agent-event") applyAgentEvent(event.event, setters);
  if (event.type === "error") {
    setters.setMessages((prev) => [
      ...prev,
      {
        id: `error-${Date.now()}`,
        role: "error",
        text: event.message,
        status: "error"
      }
    ]);
  }
}

function applyAgentEvent(
  event: AgentSessionEvent,
  setters: {
    setMessages: (value: ViewMessage[] | ((prev: ViewMessage[]) => ViewMessage[])) => void;
    setTools: (value: ViewTool[] | ((prev: ViewTool[]) => ViewTool[])) => void;
    setBusy: (value: boolean) => void;
  }
): void {
  if (event.type === "message_start") {
    const message = projectMessage(event.message);
    if (message) setters.setMessages((prev) => [...prev, message]);
    return;
  }

  if (event.type === "message_update") {
    const delta = (event.assistantMessageEvent as { delta?: unknown }).delta;
    if (typeof delta === "string") {
      setters.setMessages((prev) => appendToLastStreamingAssistant(prev, delta));
    }
    return;
  }

  if (event.type === "message_end" && event.message.role === "assistant") {
    setters.setMessages((prev) =>
      prev.map((message, index) =>
        index === prev.length - 1 && message.role === "assistant" ? { ...message, status: "complete" } : message
      )
    );
    return;
  }

  if (event.type === "tool_execution_start") {
    setters.setTools((prev) => [{ id: event.toolCallId, name: event.toolName, args: event.args }, ...prev]);
    return;
  }

  if (event.type === "tool_execution_end") {
    setters.setTools((prev) =>
      prev.map((tool) =>
        tool.id === event.toolCallId
          ? { ...tool, result: event.result, isError: event.isError, endedAt: Date.now() }
          : tool
      )
    );
  }
}

function projectMessage(message: SdkMessage): ViewMessage | undefined {
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

function appendToLastStreamingAssistant(messages: ViewMessage[], delta: string): ViewMessage[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant" && message.status === "streaming") {
      return messages.map((item, itemIndex) => (itemIndex === index ? { ...item, text: item.text + delta } : item));
    }
  }
  return [...messages, { id: createId("assistant"), role: "assistant", text: delta, status: "streaming" }];
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

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1000000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1000000).toFixed(1)}M`;
}
