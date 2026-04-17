import { Handle, Position, useConnection, type NodeProps, type Node } from '@xyflow/react';
import type { ReactNode } from 'react';
import styles from './WorkflowNode.module.css';

export type WorkflowNodeData = {
  label: string;
  icon?: ReactNode;
  iconBg?: string;
  iconColor?: string;
  variant?: 'process' | 'terminal';
  exits?: string[];
  snapTarget?: boolean;
};

export type WorkflowNode = Node<WorkflowNodeData, 'workflow'>;

export function WorkflowNode({ data }: NodeProps<WorkflowNode>) {
  const connection = useConnection();
  const isConnecting = !!connection.fromNode;
  const isTerminal = data.variant === 'terminal';

  if (isTerminal) {
    const handleClass = isConnecting ? `${styles.handle} ${styles.handleVisible}` : styles.handle;
    return (
      <div className={styles.terminal}>
        <Handle type="target" position={Position.Top} id="in" className={handleClass} />
        {data.icon && (
          <span
            className={styles.iconSlot}
            style={{ background: data.iconBg, color: data.iconColor }}
          >
            {data.icon}
          </span>
        )}
        <span className={styles.label}>{data.label}</span>
      </div>
    );
  }

  const exits = data.exits && data.exits.length > 0 ? data.exits : ['out'];
  const hasSwitcher = exits.length > 1;
  const processClass = data.snapTarget
    ? `${styles.process} ${styles.snapTarget}`
    : styles.process;
  const handleClass = isConnecting ? `${styles.handle} ${styles.handleVisible}` : styles.handle;
  const switcherHandleClass = isConnecting
    ? `${styles.switcherHandle} ${styles.handleVisible}`
    : styles.switcherHandle;

  return (
    <div className={processClass}>
      <Handle type="target" position={Position.Top} id="in" className={handleClass} />
      <div className={styles.body}>
        {data.icon && (
          <span
            className={styles.iconSlot}
            style={{ background: data.iconBg, color: data.iconColor }}
          >
            {data.icon}
          </span>
        )}
        <span className={styles.label}>{data.label}</span>
      </div>
      {hasSwitcher ? (
        <div className={styles.switcher}>
          {exits.map((exit) => (
            <div key={exit} className={styles.switcherCell}>
              <span className={styles.switcherLabel}>{exit}</span>
              <Handle
                type="source"
                position={Position.Bottom}
                id={exit}
                className={switcherHandleClass}
              />
            </div>
          ))}
        </div>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          id={exits[0]}
          className={handleClass}
        />
      )}
    </div>
  );
}
