import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './Shell.module.css';

interface ShellProps {
  sidebarHeader?: ReactNode;
  sidebarBody?: ReactNode;
  sidebarFooter?: ReactNode;
  canvas?: ReactNode;
  inspectorBody?: ReactNode;
}

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 520;
const SIDEBAR_WIDTH_KEY = 'dagsmith.shell.sidebarWidth';

const MIN_INSPECTOR_WIDTH = 220;
const MAX_INSPECTOR_WIDTH = 480;
const INSPECTOR_WIDTH_KEY = 'dagsmith.shell.inspectorWidth';
const INSPECTOR_OPEN_KEY = 'dagsmith.shell.inspectorOpen';

function readSidebarWidth(): number {
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 260;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, n));
}

function readInspectorWidth(): number {
  const raw = window.localStorage.getItem(INSPECTOR_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 280;
  return Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, n));
}

function readInspectorOpen(): boolean {
  return window.localStorage.getItem(INSPECTOR_OPEN_KEY) !== 'false';
}

export function Shell({
  sidebarHeader,
  sidebarBody,
  sidebarFooter,
  canvas,
  inspectorBody,
}: ShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth);
  const [isResizing, setIsResizing] = useState(false);

  const [inspectorWidth, setInspectorWidth] = useState<number>(readInspectorWidth);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(readInspectorOpen);
  const [isResizingInspector, setIsResizingInspector] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(inspectorWidth));
  }, [inspectorWidth]);

  useEffect(() => {
    window.localStorage.setItem(INSPECTOR_OPEN_KEY, String(inspectorOpen));
  }, [inspectorOpen]);

  // Left sidebar resize
  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    function onMove(e: MouseEvent): void {
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
      setSidebarWidth(next);
    }
    function onUp(): void { setIsResizing(false); }
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
  }, [isResizing]);

  // Right inspector resize (drag from left edge)
  const handleInspectorResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingInspector(true);
  }, []);

  useEffect(() => {
    if (!isResizingInspector) return;
    function onMove(e: MouseEvent): void {
      const rootWidth = rootRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const next = Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, rootWidth - e.clientX));
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

  return (
    <div
      ref={rootRef}
      className={styles.root}
      style={{
        ['--sidebar-width' as string]: `${sidebarWidth}px`,
        ['--inspector-width' as string]: inspectorOpen ? `${inspectorWidth}px` : '28px',
      }}
    >
      <aside className={styles.sidebar}>
        {sidebarHeader !== undefined ? sidebarHeader : (
          <div className={styles.sidebarHeader}>
            <span className={styles.brand}>DAGsmith</span>
          </div>
        )}
        <div className={styles.sidebarBody}>
          {sidebarBody !== undefined ? sidebarBody : (
            <div className={styles.sidebarPlaceholder}>sidebar</div>
          )}
        </div>
        {sidebarFooter !== undefined && (
          <div className={styles.sidebarFooter}>{sidebarFooter}</div>
        )}
        <div
          className={isResizing ? `${styles.sidebarResizer} ${styles.resizing}` : styles.sidebarResizer}
          onMouseDown={handleResizerMouseDown}
          aria-label="Resize sidebar"
          role="separator"
        />
      </aside>

      <main className={styles.workArea}>
        <div className={styles.canvasArea}>{canvas}</div>
      </main>

      <aside className={styles.inspector}>
        {inspectorOpen ? (
          <>
            <div
              className={
                isResizingInspector
                  ? `${styles.inspectorResizer} ${styles.resizing}`
                  : styles.inspectorResizer
              }
              onMouseDown={handleInspectorResizerMouseDown}
              aria-label="Resize inspector"
              role="separator"
            />
            <div className={styles.inspectorHeader}>
              <span className={styles.inspectorTitle}>Inspector</span>
              <button
                type="button"
                className={styles.inspectorToggle}
                onClick={() => setInspectorOpen(false)}
                title="Collapse inspector"
                aria-label="Collapse inspector"
              >
                ›
              </button>
            </div>
            <div className={styles.inspectorBody}>{inspectorBody}</div>
          </>
        ) : (
          <button
            type="button"
            className={styles.inspectorExpandStrip}
            onClick={() => setInspectorOpen(true)}
            title="Expand inspector"
            aria-label="Expand inspector"
          >
            ‹
          </button>
        )}
      </aside>
    </div>
  );
}
