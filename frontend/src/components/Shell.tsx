import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface ShellProps {
  sidebarBody?: ReactNode;
  canvas?: ReactNode;
  rightPanel?: ReactNode;
}

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 520;
const SIDEBAR_WIDTH_KEY = 'dagsmith.shell.sidebarWidth';

const MIN_INSPECTOR_WIDTH = 240;
const MAX_INSPECTOR_WIDTH = 480;
const INSPECTOR_WIDTH_KEY = 'dagsmith.shell.inspectorWidth';

const RESIZER_BASE = 'absolute top-0 z-[1] h-full w-1 cursor-ew-resize hover:bg-line-2';

function readStoredWidth(key: string, defaultVal: number): number {
  const raw = window.localStorage.getItem(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : defaultVal;
}

export function Shell({ sidebarBody, canvas, rightPanel }: ShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, readStoredWidth(SIDEBAR_WIDTH_KEY, 260)))
  );
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, readStoredWidth(INSPECTOR_WIDTH_KEY, 300)))
  );
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingInspector, setIsResizingInspector] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth));
  }, [inspectorWidth]);

  const handleSidebarResizerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSidebar(true);
  }, []);

  const handleInspectorResizerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingInspector(true);
  }, []);

  useEffect(() => {
    if (!isResizingSidebar) return;
    function onMove(e: MouseEvent): void {
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
      setSidebarWidth(next);
    }
    function onUp(): void { setIsResizingSidebar(false); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (!isResizingInspector) return;
    function onMove(e: MouseEvent): void {
      const windowWidth = window.innerWidth;
      const next = Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, windowWidth - e.clientX));
      setInspectorWidth(next);
    }
    function onUp(): void { setIsResizingInspector(false); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingInspector]);

  const cssVars = {
    ['--sidebar-width' as string]: `${sidebarWidth}px`,
    ['--inspector-width' as string]: rightPanel !== undefined ? `${inspectorWidth}px` : '0px',
  };

  return (
    <div
      ref={rootRef}
      className="grid h-screen w-screen grid-cols-[var(--sidebar-width,232px)_1fr_var(--inspector-width,0px)] overflow-hidden bg-surface-0 text-ink-0"
      style={cssVars}
    >
      <aside className="relative col-start-1 row-start-1 flex min-h-0 flex-col border-r border-line-0 bg-surface-0">
        <div className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-line-1 [&::-webkit-scrollbar-track]:bg-transparent">
          {sidebarBody !== undefined ? sidebarBody : (
            <div className="px-4 py-3.5 text-xs uppercase tracking-[0.06em] text-ink-3">sidebar</div>
          )}
        </div>
        <div
          className={`${RESIZER_BASE} -right-0.5 ${isResizingSidebar ? 'bg-line-2' : ''}`}
          onMouseDown={handleSidebarResizerDown}
          aria-label="Resize sidebar"
          role="separator"
        />
      </aside>

      <main className="relative col-start-2 row-start-1 flex min-h-0 min-w-0 flex-col bg-surface-0">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface-0">{canvas}</div>
      </main>

      {rightPanel !== undefined && (
        <aside className="relative col-start-3 row-start-1 flex min-h-0 flex-col overflow-hidden border-l border-line-0 bg-surface-0">
          <div
            className={`${RESIZER_BASE} -left-0.5 ${isResizingInspector ? 'bg-line-2' : ''}`}
            onMouseDown={handleInspectorResizerDown}
            aria-label="Resize inspector"
            role="separator"
          />
          {rightPanel}
        </aside>
      )}
    </div>
  );
}
