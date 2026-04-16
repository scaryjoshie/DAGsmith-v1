import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTabs } from '../tabs/TabsProvider';
import type { LeafPane, Pane, SplitPane, Tab } from '../tabs/types';
import { TabBar } from './TabBar';
import styles from './PaneTree.module.css';

type TabRenderer = (tab: Tab, pane: LeafPane) => ReactNode;

interface PaneTreeProps {
  renderTab: TabRenderer;
  renderEmpty?: () => ReactNode;
}

export function PaneTree({ renderTab, renderEmpty }: PaneTreeProps) {
  const { state } = useTabs();
  return (
    <PaneView pane={state.root} renderTab={renderTab} renderEmpty={renderEmpty} />
  );
}

interface PaneViewProps {
  pane: Pane;
  renderTab: TabRenderer;
  renderEmpty?: () => ReactNode;
}

function PaneView({ pane, renderTab, renderEmpty }: PaneViewProps) {
  if (pane.kind === 'leaf') {
    return <LeafPaneView pane={pane} renderTab={renderTab} renderEmpty={renderEmpty} />;
  }
  return <SplitPaneView pane={pane} renderTab={renderTab} renderEmpty={renderEmpty} />;
}

interface LeafPaneViewProps {
  pane: LeafPane;
  renderTab: TabRenderer;
  renderEmpty?: () => ReactNode;
}

function LeafPaneView({ pane, renderTab, renderEmpty }: LeafPaneViewProps) {
  const { state, focusPane } = useTabs();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dropEdge, setDropEdge] = useState<'right' | 'down' | null>(null);

  const onFocus = useCallback(() => focusPane(pane.id), [focusPane, pane.id]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    // tabs are @dnd-kit native — they don't use dataTransfer; ignore here
    if (!e.dataTransfer.types.includes('application/x-dagsmith-tab')) return;
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rightFrac = (rect.right - e.clientX) / rect.width;
    const bottomFrac = (rect.bottom - e.clientY) / rect.height;
    setDropEdge(
      Math.min(rightFrac, bottomFrac) > 0.3
        ? null
        : rightFrac < bottomFrac
          ? 'right'
          : 'down'
    );
  }, []);

  const onDragLeave = useCallback(() => setDropEdge(null), []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropEdge(null);
  }, []);

  const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId);
  const focused = state.activePaneId === pane.id;
  const leafClass = focused
    ? `${styles.leaf} ${styles.leafFocused}`
    : styles.leaf;

  return (
    <div
      ref={containerRef}
      className={leafClass}
      onMouseDown={onFocus}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <TabBar pane={pane} />
      <div className={styles.leafContent}>
        {pane.tabs.length === 0 ? (
          <div className={styles.emptyTabs}>
            {renderEmpty ? renderEmpty() : 'no tabs open'}
          </div>
        ) : activeTab ? (
          renderTab(activeTab, pane)
        ) : null}
      </div>
      {dropEdge === 'right' && (
        <div className={`${styles.dropZone} ${styles.dropZoneRight}`} />
      )}
      {dropEdge === 'down' && (
        <div className={`${styles.dropZone} ${styles.dropZoneBottom}`} />
      )}
    </div>
  );
}

interface SplitPaneViewProps {
  pane: SplitPane;
  renderTab: TabRenderer;
  renderEmpty?: () => ReactNode;
}

function SplitPaneView({ pane, renderTab, renderEmpty }: SplitPaneViewProps) {
  const { dispatch } = useTabs();
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent): void {
      const host = containerRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const frac =
        pane.direction === 'row'
          ? ((e.clientX - rect.left) / rect.width) * 100
          : ((e.clientY - rect.top) / rect.height) * 100;
      const clamped = Math.min(90, Math.max(10, frac));
      dispatch({
        type: 'resizeSplit',
        splitId: pane.id,
        sizes: [clamped, 100 - clamped],
      });
    }
    function onUp(): void {
      setResizing(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor =
      pane.direction === 'row' ? 'ew-resize' : 'ns-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing, pane.direction, pane.id]);

  const splitClass = `${styles.split} ${pane.direction === 'row' ? styles.splitRow : styles.splitColumn}`;
  const dividerClass = `${styles.divider} ${pane.direction === 'row' ? styles.dividerRow : styles.dividerColumn} ${resizing ? styles.resizing : ''}`;

  return (
    <div ref={containerRef} className={splitClass}>
      <div
        className={styles.splitChild}
        style={{ flexBasis: `${pane.sizes[0]}%` }}
      >
        <PaneView pane={pane.first} renderTab={renderTab} renderEmpty={renderEmpty} />
      </div>
      <div
        className={dividerClass}
        onMouseDown={onDividerDown}
        role="separator"
        aria-orientation={pane.direction === 'row' ? 'vertical' : 'horizontal'}
      />
      <div
        className={styles.splitChild}
        style={{ flexBasis: `${pane.sizes[1]}%` }}
      >
        <PaneView pane={pane.second} renderTab={renderTab} renderEmpty={renderEmpty} />
      </div>
    </div>
  );
}
