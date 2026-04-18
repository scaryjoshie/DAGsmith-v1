import { useEffect } from 'react';

interface ToastProps {
  message: string;
  onDismiss: () => void;
  duration?: number;
}

export function Toast({ message, onDismiss, duration = 5000 }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss, duration]);

  return (
    <div className="fixed top-3 left-1/2 z-[300] flex -translate-x-1/2 items-center gap-2.5 overflow-hidden rounded-xs border border-red bg-surface-1 px-3 py-[7px] font-mono text-sm whitespace-nowrap text-ellipsis text-red shadow-[0_4px_16px_rgba(0,0,0,0.5)] max-w-[520px]">
      <span className="flex-1 overflow-hidden text-ellipsis">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-sm leading-none text-ink-2 hover:text-ink-0"
      >
        ×
      </button>
    </div>
  );
}
