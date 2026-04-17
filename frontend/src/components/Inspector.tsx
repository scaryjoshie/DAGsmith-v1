import type { FlowView } from '../types';
import type { SelectedNode } from '../SelectionContext';
import styles from './Inspector.module.css';

interface InspectorProps {
  selectedNode: SelectedNode | null;
  flow: FlowView | null;
  onOpenSource: (nodeId: string, split: boolean) => void;
}

export function Inspector({ selectedNode, flow, onOpenSource }: InspectorProps) {
  if (!selectedNode || !flow) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>Select a node to inspect</div>
      </div>
    );
  }

  const node = flow.nodes[selectedNode.nodeId];
  if (!node) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>Select a node to inspect</div>
      </div>
    );
  }

  const exits = Object.entries(node.exits);
  const isSubflow = node.kind === 'flow';

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.kindChip}>{node.kind}</span>
        <span className={styles.name}>{node.name}</span>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>input</div>
        <code className={styles.typeRef} title={node.input_type}>
          {shortName(node.input_type)}
        </code>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>exits</div>
        <ul className={styles.exitsList}>
          {exits.map(([name, type]) => (
            <li key={name} className={styles.exitRow}>
              <span className={styles.exitName}>{name}</span>
              <span className={styles.arrow}>→</span>
              <code className={styles.typeRef} title={type}>
                {shortName(type)}
              </code>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>ref</div>
        <code className={styles.refLine} title={node.ref}>
          {node.ref}
        </code>
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
        ) : (
          <span className={styles.hint}>no source available</span>
        )}
      </div>

      <div className={styles.footnote}>
        label edit + exit mutations coming in M6/M7
      </div>
    </div>
  );
}

function shortName(typeRef: string): string {
  const parts = typeRef.split('.');
  return parts[parts.length - 1] ?? typeRef;
}
