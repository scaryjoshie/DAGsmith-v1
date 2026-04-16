import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTabs } from '../tabs/TabsProvider';
import type { LeafPane, Tab } from '../tabs/types';
import styles from './TabBar.module.css';

interface TabBarProps {
  pane: LeafPane;
}

interface ContextMenuState {
  paneId: string;
  tabId: string;
  x: number;
  y: number;
}

export function TabBar({ pane }: TabBarProps) {
  const { closeTab, setActiveTab, focusPane, moveTab, splitPane } = useTabs();
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  useEffect(() => {
    if (!menu) return;
    function dismiss(): void {
      setMenu(null);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenu(null);
    }
    window.addEventListener('click', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  function handleDragEnd(e: DragEndEvent): void {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = pane.tabs.findIndex((t) => t.id === active.id);
    const to = pane.tabs.findIndex((t) => t.id === over.id);
    if (from === -1 || to === -1) return;
    // arrayMove signature matches moveTab's from/to semantics
    arrayMove(pane.tabs, from, to);
    moveTab(pane.id, from, to);
  }

  if (pane.tabs.length === 0) {
    return (
      <div className={styles.root} onClick={() => focusPane(pane.id)}>
        <div className={styles.empty}>no tabs</div>
      </div>
    );
  }

  const tabIds = pane.tabs.map((t) => t.id);

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className={styles.root} onClick={() => focusPane(pane.id)}>
          <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
            {pane.tabs.map((tab) => (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={tab.id === pane.activeTabId}
                onActivate={() => setActiveTab(pane.id, tab.id)}
                onClose={() => closeTab(pane.id, tab.id)}
                onContextMenu={(x, y) =>
                  setMenu({ paneId: pane.id, tabId: tab.id, x, y })
                }
              />
            ))}
          </SortableContext>
        </div>
      </DndContext>
      {menu && (
        <div
          className={styles.menu}
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              splitPane(menu.paneId, 'right', menu.tabId);
              setMenu(null);
            }}
          >
            Split right
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              splitPane(menu.paneId, 'down', menu.tabId);
              setMenu(null);
            }}
          >
            Split down
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              closeTab(menu.paneId, menu.tabId);
              setMenu(null);
            }}
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}

interface SortableTabProps {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onContextMenu: (x: number, y: number) => void;
}

function SortableTab({
  tab,
  isActive,
  onActivate,
  onClose,
  onContextMenu,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const classes = [styles.tab];
  if (isActive) classes.push(styles.active);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={classes.join(' ')}
      onClick={onActivate}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      aria-selected={isActive}
      title={tab.title}
      {...attributes}
      {...listeners}
      role="tab"
    >
      <span className={styles.tabKindBadge}>
        {tab.kind === 'flow' ? 'flow' : 'src'}
      </span>
      <span className={styles.tabTitle}>{tab.title}</span>
      <button
        type="button"
        className={styles.tabClose}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${tab.title}`}
      >
        ×
      </button>
    </div>
  );
}
