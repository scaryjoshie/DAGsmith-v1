import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { ReactNode } from 'react';
import styles from './WorkflowNode.module.css';

export type WorkflowNodeData = {
  label: string;
  icon?: ReactNode;
  iconBg?: string;
  iconColor?: string;
  variant?: 'process' | 'terminal';
};

export type WorkflowNode = Node<WorkflowNodeData, 'workflow'>;

export function WorkflowNode({ data }: NodeProps<WorkflowNode>) {
  const isTerminal = data.variant === 'terminal';

  return (
    <div className={isTerminal ? styles.terminal : styles.process}>
      <Handle type="target" position={Position.Top} className={styles.handle} />
      {data.icon && (
        <span
          className={styles.iconSlot}
          style={{ background: data.iconBg, color: data.iconColor }}
        >
          {data.icon}
        </span>
      )}
      <span className={styles.label}>{data.label}</span>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}
