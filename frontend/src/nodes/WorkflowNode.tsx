import { Fragment } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { ReactNode } from 'react';
import styles from './WorkflowNode.module.css';

export type WorkflowNodeData = {
  label: string;
  icon?: ReactNode;
  iconBg?: string;
  iconColor?: string;
  variant?: 'process' | 'terminal';
  exits?: string[];
};

export type WorkflowNode = Node<WorkflowNodeData, 'workflow'>;

export function WorkflowNode({ data }: NodeProps<WorkflowNode>) {
  const isTerminal = data.variant === 'terminal';

  if (isTerminal) {
    return (
      <div className={styles.terminal}>
        <Handle type="target" position={Position.Top} id="in" className={styles.handle} />
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
  const showExitLabels = exits.length > 1;

  return (
    <div className={styles.process}>
      <Handle type="target" position={Position.Top} id="in" className={styles.handle} />
      {data.icon && (
        <span
          className={styles.iconSlot}
          style={{ background: data.iconBg, color: data.iconColor }}
        >
          {data.icon}
        </span>
      )}
      <span className={styles.label}>{data.label}</span>
      {exits.map((exit, idx) => {
        const leftPct = ((idx + 1) / (exits.length + 1)) * 100;
        return (
          <Fragment key={exit}>
            {showExitLabels && (
              <span
                className={styles.exitLabel}
                style={{ left: `${leftPct}%` }}
              >
                {exit}
              </span>
            )}
            <Handle
              type="source"
              position={Position.Bottom}
              id={exit}
              className={styles.handle}
              style={{ left: `${leftPct}%` }}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
