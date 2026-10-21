/** A small modal that asks one question. Escape or a tap on the backdrop means "stay". */
import { useEffect, useRef, type ReactNode } from 'react';

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, children, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title" style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
          {title}
        </h2>
        <div className="helper" style={{ marginTop: 8, fontSize: '0.9375rem', lineHeight: 1.5 }}>
          {children}
        </div>
        <div className="stack" style={{ marginTop: 16, gap: 10 }}>
          <button type="button" className="btn btn-secondary btn-sm" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
