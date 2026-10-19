import { Component, type ErrorInfo, type ReactNode } from "react";
import { pushCapturedError, requestBugReport } from "./bugReport";

interface Props {
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Fault isolation: a pane that throws renders an inline, recoverable error
 * in its own tab instead of white-screening the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[pane:${this.props.label}]`, error, info.componentStack);
    // Feed the reporter's ring buffer so "Report this" carries the crash even though the
    // boundary contained it (console.error is also captured, but keep the component stack).
    pushCapturedError("boundary", `[pane:${this.props.label}] ${error.stack || error.message}\n${info.componentStack ?? ""}`);
  }

  private report = (): void => {
    const { label } = this.props;
    const { error } = this.state;
    requestBugReport({
      category: "crash",
      title: `Crash while rendering ${label}`,
      description: `The "${label}" view failed to render.\n\nError: ${error?.message ?? "unknown"}`,
    });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div className="errpane">
          <h3>Couldn&apos;t render {this.props.label}</h3>
          <p className="note">{error.message}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={() => this.setState({ error: null })}>Retry</button>
            <button className="btn-ghost" onClick={this.report}>Report this…</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
