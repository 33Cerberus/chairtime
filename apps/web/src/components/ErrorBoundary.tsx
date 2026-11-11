import { Component, ErrorInfo, ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Catches a crash while rendering, so a bug in one screen shows a way forward instead of a
 * blank page. A failed lazy import (a new version was deployed while the tab was open) is
 * the most common cause, and a reload fixes it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error while rendering', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const stale = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(this.state.error.message);
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 text-center">
        <span className="pole mb-8 h-12 w-3.5 rounded-full ring-1 ring-ink-900/15" />
        <h1 className="display text-5xl text-ink-950 sm:text-6xl">
          {stale ? (
            <>
              A new version <span className="italic">is ready.</span>
            </>
          ) : (
            <>
              Something <span className="italic">went wrong.</span>
            </>
          )}
        </h1>
        <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-500">
          {stale
            ? 'The site was updated while this page was open. Reload to continue — nothing you saved is lost.'
            : 'This page hit an unexpected problem. Reloading usually fixes it. If it keeps happening, please call the shop.'}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-11 items-center rounded-full bg-ink-900 px-6 text-sm font-medium text-paper hover:bg-ink-700"
          >
            Reload the page
          </button>
          <a href="/" className="inline-flex h-11 items-center rounded-full border border-ink-900/15 bg-card px-6 text-sm font-medium text-ink-900 hover:border-ink-900/40">
            Back to the start
          </a>
        </div>
      </div>
    );
  }
}
