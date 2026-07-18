export function Snackbar({
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <div className="snackbar" role="status">
      <span>{message}</span>
      <div className="row">
        {actionLabel && onAction ? (
          <button type="button" className="primary" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="ghost" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}
