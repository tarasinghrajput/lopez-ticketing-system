import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X, LoaderCircle, AlertCircle, Armchair, ArrowUpRight } from 'lucide-react';
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} /> Setting the table…
    </div>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div className="error" role="alert">
      <AlertCircle size={18} />
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Armchair size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge badge-${value.toLowerCase().replaceAll('_', '-')}`}>
      <i />
      {value.replaceAll('_', ' ').toLowerCase()}
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const close = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener('cancel', close);
    return () => {
      dialog.removeEventListener('cancel', close);
      dialog.close();
    };
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId}>
      <header>
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
export function TableDrawing({ capacity, state }: { capacity: number; state: string }) {
  return (
    <svg className={`table-drawing drawing-${state}`} viewBox="0 0 132 94" aria-hidden="true">
      <rect className="chair" x="42" y="7" width="19" height="12" rx="4" />
      <rect className="chair" x="71" y="7" width="19" height="12" rx="4" />
      <rect className="chair" x="42" y="75" width="19" height="12" rx="4" />
      <rect className="chair" x="71" y="75" width="19" height="12" rx="4" />
      {capacity > 4 && (
        <>
          <rect className="chair" x="10" y="35" width="12" height="23" rx="4" />
          <rect className="chair" x="110" y="35" width="12" height="23" rx="4" />
        </>
      )}
      <rect
        className="table-top"
        x="27"
        y="24"
        width="78"
        height="46"
        rx={capacity === 2 ? 23 : 11}
      />
      {state === 'occupied' || state === 'overdue' ? (
        <>
          <circle className="plate" cx="48" cy="47" r="10" />
          <circle className="plate" cx="84" cy="47" r="10" />
          <circle cx="48" cy="47" r="5" fill="none" stroke="currentColor" opacity=".3" />
          <circle cx="84" cy="47" r="5" fill="none" stroke="currentColor" opacity=".3" />
        </>
      ) : (
        <path d="M62 43h8M66 39v8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      )}
    </svg>
  );
}
export function Stat({
  label,
  value,
  foot,
  icon,
}: {
  label: string;
  value: string | number;
  foot: string;
  icon: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        {foot}
        <ArrowUpRight size={13} />
      </div>
    </div>
  );
}
