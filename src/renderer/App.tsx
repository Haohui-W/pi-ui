import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import type { PiSessionSummary } from "../shared/ipc";
import type { RpcAgentMessage, RpcCommand, RpcEnvelope, RpcResponse, RpcSessionState, SessionStats } from "../shared/rpc";

type ViewRole = "system" | "user" | "assistant" | "tool" | "error";
type WorkspaceMode = "home" | "session";

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
  const [mode, setMode] = useState<WorkspaceMode>("home");
  const [sessions, setSessions] = useState<PiSessionSummary[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [activeSessionPath, setActiveSessionPath] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [tools, setTools] = useState<ViewTool[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
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

    void refreshSessions();
    return () => {
      for (const cleanup of cleanups) cleanup();
      void window.pi.stopRpc();
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (snapshot.state?.sessionFile) {
      setActiveSessionPath(snapshot.state.sessionFile);
    }
  }, [snapshot.state?.sessionFile]);

  const activeTools = useMemo(() => tools.filter((tool) => !tool.endedAt).length, [tools]);
  const canSend = mode === "session" && prompt.trim().length > 0 && !starting;
  const groupedSessions = useMemo(() => groupSessionsByCwd(sessions), [sessions]);

  async function refreshSessions(): Promise<void> {
    setLoadingSessions(true);
    try {
      const nextSessions = await window.pi.listSessions();
      setSessions(nextSessions);
      setFolders((prev) => mergeFolders(prev, nextSessions.map((session) => session.cwd).filter(Boolean)));
    } catch (error) {
      pushError(setMessages, formatError(error));
    } finally {
      setLoadingSessions(false);
    }
  }

  async function pickFolder(): Promise<void> {
    const folder = await window.pi.pickFolder();
    if (!folder) return;
    setFolders((prev) => mergeFolders([folder], prev));
    setSelectedFolder(folder);
    setMode("home");
  }

  async function createSessionFromFolder(folder = selectedFolder): Promise<void> {
    if (!folder) return;
    await openSession({ cwd: folder, label: `New session in ${shortPath(folder)}` });
  }

  async function restoreSession(session: PiSessionSummary): Promise<void> {
    if (!session.cwdExists) {
      setSelectedFolder("");
      setMode("home");
      pushError(setMessages, `Session folder no longer exists: ${session.cwd}. Open the folder again before restoring this session.`);
      return;
    }
    await openSession({ cwd: session.cwd, sessionPath: session.path, label: `Restored ${session.title}` });
    setActiveSessionPath(session.path);
  }

  async function openSession(options: { cwd: string; sessionPath?: string; label: string }): Promise<void> {
    setStarting(true);
    setBusy(false);
    setMessages([]);
    setTools([]);
    setSnapshot({ cwd: options.cwd });
    try {
      await window.pi.startRpc({ cwd: options.cwd || undefined, sessionPath: options.sessionPath });
      setMode("session");
      setActiveSessionPath(options.sessionPath ?? "");
      send({ type: "get_state" });
      send({ type: "get_session_stats" });
      send({ type: "get_messages" });
      pushSystem(setMessages, options.label);
      void refreshSessions();
    } catch (error) {
      setMode("home");
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
            <p>Desktop</p>
          </div>
        </div>

        <button className="primary-action" type="button" onClick={pickFolder}>
          Open Folder
        </button>

        <section className="nav-block">
          <header>
            <span>Projects</span>
          </header>
          {folders.length === 0 ? (
            <p className="muted">Open a folder to start.</p>
          ) : (
            folders.map((folder) => (
              <button
                className={folder === selectedFolder ? "nav-row selected" : "nav-row"}
                key={folder}
                type="button"
                onClick={() => {
                  setSelectedFolder(folder);
                  setMode("home");
                }}
              >
                <span>{folderName(folder)}</span>
                <small>{shortPath(folder)}</small>
              </button>
            ))
          )}
        </section>

        <section className="nav-block sessions-block">
          <header>
            <span>Sessions</span>
            <button type="button" onClick={() => void refreshSessions()} disabled={loadingSessions}>
              Refresh
            </button>
          </header>
          {loadingSessions ? <p className="muted">Loading sessions...</p> : null}
          {!loadingSessions && sessions.length === 0 ? <p className="muted">No pi sessions found.</p> : null}
          {groupedSessions.map((group) => (
            <div className="session-group" key={group.cwd}>
              <h2>{folderName(group.cwd)}</h2>
              {group.sessions.map((session) => (
                <button
                  className={session.path === activeSessionPath ? "session-row selected" : "session-row"}
                  key={session.path}
                  type="button"
                  onClick={() => void restoreSession(session)}
                  disabled={starting}
                >
                  <span>{session.title}</span>
                  <small>
                    {formatRelativeTime(session.updatedAt)} · {session.messageCount} messages
                    {session.cwdExists ? "" : " · missing folder"}
                  </small>
                </button>
              ))}
            </div>
          ))}
        </section>
      </aside>

      <section className="conversation">
        <header className="topbar">
          <div>
            <span className={busy ? "status busy" : mode === "session" ? "status" : "status idle"} />
            {mode === "session" ? (busy ? "Agent running" : "Session ready") : "Home"}
          </div>
          {mode === "session" ? (
            <button type="button" onClick={() => send({ type: "abort" })} disabled={!busy}>
              Abort
            </button>
          ) : null}
        </header>

        {mode === "home" ? (
          <HomeView
            selectedFolder={selectedFolder}
            sessions={selectedFolder ? sessions.filter((session) => session.cwd === selectedFolder) : sessions}
            starting={starting}
            onPickFolder={() => void pickFolder()}
            onCreateSession={() => void createSessionFromFolder()}
            onRestoreSession={(session) => void restoreSession(session)}
          />
        ) : (
          <>
            <div className="messages" ref={listRef}>
              {messages.length === 0 ? (
                <div className="empty">
                  <h2>Session is ready</h2>
                  <p>Send a prompt when you want pi to start working in this folder.</p>
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
          </>
        )}
      </section>

      <aside className="tools">
        <header>
          <h2>Context</h2>
          <span>{activeTools} running</span>
        </header>
        <SessionMeta snapshot={snapshot} />
        <div className="tool-list">
          {tools.length === 0 ? (
            <p className="muted">Tool calls will appear here once a session runs.</p>
          ) : (
            tools.map((tool) => <ToolRow key={tool.id} tool={tool} />)
          )}
        </div>
      </aside>
    </main>
  );
}

function HomeView({
  selectedFolder,
  sessions,
  starting,
  onPickFolder,
  onCreateSession,
  onRestoreSession,
}: {
  selectedFolder: string;
  sessions: PiSessionSummary[];
  starting: boolean;
  onPickFolder: () => void;
  onCreateSession: () => void;
  onRestoreSession: (session: PiSessionSummary) => void;
}): React.JSX.Element {
  return (
    <div className="home">
      <section className="hero">
        <h2>{selectedFolder ? folderName(selectedFolder) : "Pi Agent"}</h2>
        <p>{selectedFolder ? selectedFolder : "Open a folder or resume a previous pi session to begin."}</p>
        <div className="home-actions">
          <button type="button" onClick={onPickFolder}>
            Open Folder
          </button>
          <button type="button" onClick={onCreateSession} disabled={!selectedFolder || starting}>
            New Session
          </button>
        </div>
      </section>

      <section className="recent">
        <header>
          <h3>{selectedFolder ? "Folder Sessions" : "Recent Sessions"}</h3>
          <span>{sessions.length}</span>
        </header>
        {sessions.length === 0 ? (
          <p className="muted">No sessions for this view yet.</p>
        ) : (
          sessions.slice(0, 8).map((session) => (
            <button className="recent-row" key={session.path} type="button" onClick={() => onRestoreSession(session)}>
              <strong>{session.title}</strong>
              <span>{session.firstMessage}</span>
              <small>
                {shortPath(session.cwd)} · {formatRelativeTime(session.updatedAt)}
                {session.cwdExists ? "" : " · missing folder"}
              </small>
            </button>
          ))
        )}
      </section>
    </div>
  );
}

function SessionMeta({ snapshot }: { snapshot: Snapshot }): React.JSX.Element {
  const model = snapshot.state?.model;
  const stats = snapshot.stats;
  return (
    <section className="meta">
      <div>
        <span>Folder</span>
        <strong>{snapshot.cwd ? shortPath(snapshot.cwd) : "No session selected"}</strong>
      </div>
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
  if (response.command === "get_messages") {
    const data = response.data as { messages?: unknown } | undefined;
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    setters.setMessages((prev) => [
      ...prev,
      ...messages.flatMap((message) => {
        if (!isRpcAgentMessage(message)) return [];
        const projected = projectMessage(message, true);
        return projected ? [projected] : [];
      }),
    ]);
  }
}

function projectMessage(message: RpcAgentMessage, complete = false): ViewMessage | undefined {
  if (message.role === "user") {
    return { id: createId("user"), role: "user", text: extractContentText(message.content), status: "complete" };
  }
  if (message.role === "assistant") {
    return {
      id: createId("assistant"),
      role: "assistant",
      text: extractContentText(message.content),
      status: complete ? "complete" : "streaming",
    };
  }
  if (message.role === "toolResult") {
    return { id: createId("tool"), role: "tool", text: extractContentText(message.content), status: "complete" };
  }
  return undefined;
}

function groupSessionsByCwd(sessions: PiSessionSummary[]): Array<{ cwd: string; sessions: PiSessionSummary[] }> {
  const groups = new Map<string, PiSessionSummary[]>();
  for (const session of sessions) {
    const key = session.cwd || "Unknown folder";
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return Array.from(groups, ([cwd, items]) => ({ cwd, sessions: items }));
}

function mergeFolders(primary: string[], secondary: string[]): string[] {
  return Array.from(new Set([...primary, ...secondary].filter(Boolean)));
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

function folderName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts.at(-1) || path;
}

function shortPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return normalized;
  return `${parts[0]}/.../${parts.slice(-2).join("/")}`;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const delta = Date.now() - date.getTime();
  if (Number.isNaN(delta)) return "unknown";
  const minutes = Math.max(1, Math.round(delta / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return date.toLocaleDateString();
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
