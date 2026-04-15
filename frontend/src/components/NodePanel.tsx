import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import type { NodeView } from '../types';
import styles from './NodePanel.module.css';

interface NodePanelProps {
  node: NodeView;
}

export function NodePanel({ node }: NodePanelProps) {
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.kind}>{node.kind}</span>
        <h3 className={styles.name}>{node.name}</h3>
      </header>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Input type</h4>
        <code className={styles.typeRef}>{shortName(node.input_type)}</code>
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Exits</h4>
        <ul className={styles.exits}>
          {Object.entries(node.exits).map(([exit, type]) => (
            <li key={exit}>
              <span className={styles.exitName}>{exit}</span>
              <span className={styles.arrow}>→</span>
              <code className={styles.typeRef}>{shortName(type)}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>
          Ref
          {node.selector_ref && <span className={styles.sel}> + selector</span>}
        </h4>
        <code className={styles.refLine}>{node.ref}</code>
        {node.selector_ref && <code className={styles.refLine}>{node.selector_ref}</code>}
      </section>

      {node.source_code && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>
            Source
            {node.source_path && (
              <span className={styles.path}>
                {' '}
                {node.source_path.split('/').slice(-3).join('/')}
              </span>
            )}
          </h4>
          <div className={styles.editor}>
            <CodeMirror
              value={node.source_code}
              editable={false}
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
              }}
              extensions={[python()]}
              theme="dark"
            />
          </div>
        </section>
      )}
    </div>
  );
}

function shortName(typeRef: string): string {
  // Show just the class name for display, keep the tooltip full.
  const parts = typeRef.split('.');
  return parts[parts.length - 1] ?? typeRef;
}
