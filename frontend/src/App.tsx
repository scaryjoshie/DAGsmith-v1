import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MarkerType,
  type Edge,
  type EdgeMarker,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TbDatabase, TbBoxMultiple } from 'react-icons/tb';

import { WorkflowNode } from './nodes/WorkflowNode';
import type { WorkflowNode as WorkflowNodeType } from './nodes/WorkflowNode';
import { PythonIcon } from './icons/BrandIcons';
import styles from './App.module.css';

const nodeTypes = { workflow: WorkflowNode };

const X = 200;

const initialNodes: WorkflowNodeType[] = [
  {
    id: '1',
    type: 'workflow',
    position: { x: X, y: 0 },
    data: { label: 'Input', variant: 'terminal' },
  },
  {
    id: '2',
    type: 'workflow',
    position: { x: X - 20, y: 80 },
    data: {
      label: 'Load dataset from storage',
      icon: <TbDatabase size={13} />,
      iconBg: '#6366f1',
      iconColor: '#fff',
    },
  },
  {
    id: '3',
    type: 'workflow',
    position: { x: X - 20, y: 160 },
    data: {
      label: 'Preprocessing chain',
      icon: <TbBoxMultiple size={13} />,
      iconBg: '#3b82f6',
      iconColor: '#fff',
    },
  },
  {
    id: '4',
    type: 'workflow',
    position: { x: X - 20, y: 240 },
    data: {
      label: 'Analyse sentiment with nltk',
      icon: <PythonIcon size={14} />,
    },
  },
  {
    id: '5',
    type: 'workflow',
    position: { x: X - 20, y: 320 },
    data: {
      label: 'Transform results',
      icon: <PythonIcon size={14} />,
    },
  },
  {
    id: '6',
    type: 'workflow',
    position: { x: X - 20, y: 400 },
    data: {
      label: 'Save to database',
      icon: <TbDatabase size={13} />,
      iconBg: '#6366f1',
      iconColor: '#fff',
    },
  },
  {
    id: '7',
    type: 'workflow',
    position: { x: X, y: 480 },
    data: { label: 'Result', variant: 'terminal' },
  },
];

const edgeMarker: EdgeMarker = {
  type: MarkerType.ArrowClosed,
  color: '#3a3d4a',
  width: 12,
  height: 12,
};

const defaultEdgeOptions = {
  type: 'straight',
  style: { stroke: '#3a3d4a', strokeWidth: 1.2 },
  markerEnd: edgeMarker,
};

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2' },
  { id: 'e2-3', source: '2', target: '3' },
  { id: 'e3-4', source: '3', target: '4' },
  { id: 'e4-5', source: '4', target: '5' },
  { id: 'e5-6', source: '5', target: '6' },
  { id: 'e6-7', source: '6', target: '7' },
];

export default function App() {
  return (
    <div className={styles.root}>
      <ReactFlow
        defaultNodes={initialNodes}
        defaultEdges={initialEdges}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        fitViewOptions={{ padding: 0.4 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1.5}
          color="#3a3d4a"
        />
      </ReactFlow>
    </div>
  );
}
