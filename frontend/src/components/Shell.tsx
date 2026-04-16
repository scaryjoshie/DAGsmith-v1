import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './Shell.module.css';

interface ShellProps {
  sidebarHeader?: ReactNode;
  sidebarBody?: ReactNode;
  sidebarFooter?: ReactNode;
  canvas?: ReactNode;
}

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 520;
const SIDEBAR_WIDTH_KEY = 'dagsmith.shell.sidebarWidth';

function readSidebarWidth(): number {
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 260;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, n));
}

export function Shell({
  sidebarHeader,
  sidebarBody,
  sidebarFooter,
  canvas,
}: ShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(readSidebarWidth);
  const [isResizing, setIsResizing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

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
    function onUp(): void {
      setIsResizing(false);
    }
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

  return (
    <div
      ref={rootRef}
      className={styles.root}
      style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` }}
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
          className={
            isResizing
              ? `${styles.sidebarResizer} ${styles.resizing}`
              : styles.sidebarResizer
          }
          onMouseDown={handleResizerMouseDown}
          aria-label="Resize sidebar"
          role="separator"
        />
      </aside>

      <main className={styles.workArea}>
        <div className={styles.canvasArea}>{canvas}</div>
      </main>
    </div>
  );
}
