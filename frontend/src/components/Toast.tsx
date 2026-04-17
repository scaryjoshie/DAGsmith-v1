import { useEffect } from 'react';
import styles from './Toast.module.css';

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
    <div className={styles.toast}>
      <span className={styles.msg}>{message}</span>
      <button type="button" className={styles.close} onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  );
}
