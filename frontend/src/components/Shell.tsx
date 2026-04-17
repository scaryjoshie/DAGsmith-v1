import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './Shell.module.css';

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
    <div ref={rootRef} className={styles.root} style={cssVars}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBody}>
          {sidebarBody !== undefined ? sidebarBody : (
            <div className={styles.sidebarPlaceholder}>sidebar</div>
          )}
        </div>
        <div
          className={isResizingSidebar ? `${styles.sidebarResizer} ${styles.resizing}` : styles.sidebarResizer}
          onMouseDown={handleSidebarResizerDown}
          aria-label="Resize sidebar"
          role="separator"
        />
      </aside>

      <main className={styles.workArea}>
        <div className={styles.canvasArea}>{canvas}</div>
      </main>

      {rightPanel !== undefined && (
        <aside className={styles.inspectorPanel}>
          <div
            className={isResizingInspector ? `${styles.inspectorResizer} ${styles.resizing}` : styles.inspectorResizer}
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
