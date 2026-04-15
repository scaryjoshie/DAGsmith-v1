import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { reloadWorkspace, updateNodeSource } from '../api';
import type { NodeView } from '../types';
import styles from './NodePanel.module.css';

interface NodePanelProps {
  node: NodeView;
  workspace: string;
  flowId: string;
  editMode: boolean;
  onEnterEditMode: () => void;
  onExitEditMode: () => void;
  onSaveComplete: () => Promise<void> | void;
}

export function NodePanel({
  node,
  workspace,
  flowId,
  editMode,
  onEnterEditMode,
  onExitEditMode,
  onSaveComplete,
}: NodePanelProps) {
  const [draftSource, setDraftSource] = useState<string>(node.source_code ?? '');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Reset draft and errors whenever the selected node changes.
  useEffect(() => {
    setDraftSource(node.source_code ?? '');
    setSaveError(null);
    setJustSaved(false);
  }, [node.name, node.source_code]);

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateNodeSource(workspace, flowId, node.name, draftSource);
      await reloadWorkspace(workspace);
      await onSaveComplete();
      onExitEditMode();
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2000);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    setDraftSource(node.source_code ?? '');
    setSaveError(null);
    onExitEditMode();
  }

  return (
    <div className={editMode ? `${styles.panel} ${styles.panelEditing}` : styles.panel}>
      <header className={styles.header}>
        <span className={styles.kind}>{node.kind}</span>
        <h3 className={styles.name}>{node.name}</h3>
        <div className={styles.headerActions}>
          {justSaved && !editMode && <span className={styles.saved}>saved</span>}
          {!editMode && node.source_code && (
            <button
              type="button"
              className={styles.editButton}
              onClick={onEnterEditMode}
            >
              Edit
            </button>
          )}
          {editMode && (
            <>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={handleCancel}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.saveButton}
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </header>

      {saveError && (
        <div className={styles.saveError}>
          <div className={styles.saveErrorLabel}>Save failed</div>
          <pre className={styles.saveErrorBody}>{saveError}</pre>
        </div>
      )}

      {!editMode && (
        <>
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
            {node.selector_ref && (
              <code className={styles.refLine}>{node.selector_ref}</code>
            )}
          </section>
        </>
      )}

      {node.source_code && (
        <section
          className={
            editMode
              ? `${styles.section} ${styles.sourceSectionEditing}`
              : styles.section
          }
        >
          <h4 className={styles.sectionTitle}>
            Source
            {node.source_path && (
              <span className={styles.path}>
                {' '}
                {node.source_path.split('/').slice(-3).join('/')}
              </span>
            )}
          </h4>
          <div
            className={
              editMode ? `${styles.editor} ${styles.editorEditing}` : styles.editor
            }
          >
            <CodeMirror
              value={editMode ? draftSource : node.source_code}
              editable={editMode}
              readOnly={!editMode}
              onChange={(v) => {
                if (editMode) setDraftSource(v);
              }}
              height={editMode ? '100%' : undefined}
              basicSetup={{
                lineNumbers: true,
                foldGutter: false,
                highlightActiveLine: editMode,
                highlightActiveLineGutter: editMode,
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
