import { useEffect } from 'react';
import type { FlowView } from '../types';
import type { SelectedNode } from '../SelectionContext';
import styles from './Inspector.module.css';

interface InspectorProps {
  selectedNode: SelectedNode;
  flow: FlowView | null;
  onOpenSource: (nodeId: string, split: boolean) => void;
  onDismiss: () => void;
}

export function Inspector({ selectedNode, flow, onOpenSource, onDismiss }: InspectorProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  const node = flow?.nodes[selectedNode.nodeId];

  if (!node) {
    return (
      <div className={styles.root}>
        <div className={styles.loading}>loading…</div>
        <button type="button" className={styles.dismiss} onClick={onDismiss} title="Dismiss (Esc)" aria-label="Dismiss inspector">✕</button>
      </div>
    );
  }

  const exits = Object.entries(node.exits);
  const isSubflow = node.kind === 'flow';

  return (
    <div className={styles.root}>
      <div className={styles.identity}>
        <span className={styles.kindChip}>{node.kind}</span>
        <span className={styles.name}>{node.name}</span>
      </div>

      <div className={styles.fields}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>input</span>
          <code className={styles.typeRef} title={node.input_type}>{shortName(node.input_type)}</code>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>ref</span>
          <code className={styles.refValue} title={node.ref}>{node.ref}</code>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>exits</span>
          <div className={styles.exitPills}>
            {exits.map(([name, type]) => (
              <span key={name} className={styles.exitPill} title={type}>
                <span className={styles.exitName}>{name}</span>
                <span className={styles.exitType}>{shortName(type)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        {isSubflow ? (
          <button
            type="button"
            className={styles.action}
            onClick={(e) => onOpenSource(node.name, e.shiftKey)}
            title="Shift-click to split"
          >
            Enter subflow →
          </button>
        ) : node.source_code ? (
          <button
            type="button"
            className={styles.action}
            onClick={(e) => onOpenSource(node.name, e.shiftKey)}
            title="Shift-click to open as split"
          >
            Open source →
          </button>
        ) : null}
      </div>

      <button type="button" className={styles.dismiss} onClick={onDismiss} title="Dismiss (Esc)" aria-label="Dismiss inspector">✕</button>
    </div>
  );
}

function shortName(typeRef: string): string {
  const parts = typeRef.split('.');
  return parts[parts.length - 1] ?? typeRef;
}
