import {
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  SessionManager
} from "@earendil-works/pi-coding-agent";
import type { PiEvent, SessionSnapshot, StartSessionOptions } from "../shared/ipc";

type Emit = (event: PiEvent) => void;

export class PiSessionHost {
  private session?: AgentSession;
  private unsubscribe?: () => void;
  private readonly emit: Emit;

  constructor(emit: Emit) {
    this.emit = emit;
  }

  async start(options: StartSessionOptions = {}): Promise<SessionSnapshot> {
    await this.dispose();

    const cwd = options.cwd || process.cwd();
    const sessionManager = options.continueRecent ? SessionManager.continueRecent(cwd) : SessionManager.create(cwd);
    const { session, modelFallbackMessage } = await createAgentSession({ cwd, sessionManager });
    this.session = session;
    this.unsubscribe = session.subscribe((event) => this.handleEvent(event));

    if (modelFallbackMessage) {
      this.emit({ type: "error", message: modelFallbackMessage });
    }

    const snapshot = this.snapshot();
    this.emit({ type: "snapshot", snapshot });
    return snapshot;
  }

  async prompt(prompt: string): Promise<void> {
    if (!this.session) {
      await this.start();
    }
    const text = prompt.trim();
    if (!text) return;

    this.emit({ type: "busy", value: true });
    try {
      await this.session?.prompt(text);
    } catch (error) {
      this.emit({ type: "error", message: formatError(error) });
    } finally {
      this.emit({ type: "busy", value: false });
      if (this.session) this.emit({ type: "snapshot", snapshot: this.snapshot() });
    }
  }

  async abort(): Promise<void> {
    this.session?.abort();
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.session?.dispose();
    this.session = undefined;
  }

  private handleEvent(event: AgentSessionEvent): void {
    this.emit({ type: "agent-event", event });

    if (event.type === "message_end" && event.message.role === "assistant") {
      this.emit({ type: "snapshot", snapshot: this.snapshot() });
      return;
    }

    if (event.type === "agent_start") {
      this.emit({ type: "busy", value: true });
    } else if (event.type === "agent_end") {
      this.emit({ type: "busy", value: event.willRetry });
    }
  }

  private snapshot(): SessionSnapshot {
    const session = this.session;
    const stats = session?.getSessionStats();

    return {
      sessionId: session?.sessionId,
      sessionFile: session?.sessionFile,
      cwd: session?.sessionManager.getCwd() ?? process.cwd(),
      model: session?.model ? `${session.model.provider}/${session.model.id}` : undefined,
      thinkingLevel: session?.thinkingLevel,
      isStreaming: session?.isStreaming ?? false,
      stats
    };
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
