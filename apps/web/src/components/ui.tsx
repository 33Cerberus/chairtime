import clsx, { ClassValue } from 'clsx';
import { AlertCircle, Check, ChevronDown, Info, Loader2, X } from 'lucide-react';
import {
  ButtonHTMLAttributes,
  forwardRef,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from 'react';
import { Link, LinkProps } from 'react-router';
import { BookingStatus, OrderStatus, PaymentStatus } from '../lib/api';
import { initials } from '../lib/format';

export const cn = (...v: ClassValue[]) => clsx(v);

// ---- Buttons ----------------------------------------------------------------------------------

type Variant = 'primary' | 'brass' | 'outline' | 'ghost' | 'danger' | 'light';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-ink-900 text-paper hover:bg-ink-700 active:bg-ink-950 shadow-sm',
  brass: 'bg-brass-400 text-ink-950 hover:bg-brass-300 active:bg-brass-500 shadow-sm',
  outline: 'border border-ink-900/15 bg-card text-ink-900 hover:border-ink-900/35 hover:bg-white',
  ghost: 'text-ink-700 hover:bg-ink-900/6 hover:text-ink-950',
  danger: 'bg-bad-600 text-white hover:brightness-110 shadow-sm',
  light: 'bg-paper text-ink-950 hover:bg-white shadow-sm',
};
const SIZE: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13px] gap-1.5 rounded-full',
  md: 'h-11 px-5 text-sm gap-2 rounded-full',
  lg: 'h-13 px-7 text-[15px] gap-2.5 rounded-full',
};

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', extra?: ClassValue) =>
  cn(
    'inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-[background,border-color,color,transform,filter] duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
    VARIANT[variant],
    SIZE[size],
    extra,
  );

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant,
  size,
  className,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; className?: string }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-ink-900/7 hover:text-ink-950 disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---- Form fields ------------------------------------------------------------------------------

const CONTROL =
  'w-full rounded-xl border border-ink-900/12 bg-white px-3.5 text-[15px] text-ink-950 placeholder:text-ink-400 transition-[border-color,box-shadow] duration-150 hover:border-ink-900/25 focus:border-brass-500 focus:outline-none focus:ring-4 focus:ring-brass-400/20 disabled:bg-ink-50 disabled:text-ink-500';

interface FieldShell {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
}

function Shell({ label, hint, error, id, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-[13px] font-medium text-ink-700">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="flex items-center gap-1.5 text-[13px] text-bad-600" role="alert">
          <AlertCircle className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : (
        hint && <p className="text-[13px] text-ink-500">{hint}</p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldShell>(function Input(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Shell label={label} hint={hint} error={error} id={fieldId}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={!!error}
        className={cn(CONTROL, 'h-11', error && 'border-bad-600/60', className)}
        {...rest}
      />
    </Shell>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldShell>(
  function Textarea({ label, hint, error, className, id, ...rest }, ref) {
    const auto = useId();
    const fieldId = id ?? auto;
    return (
      <Shell label={label} hint={hint} error={error} id={fieldId}>
        <textarea ref={ref} id={fieldId} className={cn(CONTROL, 'min-h-24 py-2.5 leading-relaxed', className)} {...rest} />
      </Shell>
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldShell>(function Select(
  { label, hint, error, className, id, children, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Shell label={label} hint={hint} error={error} id={fieldId}>
      <div className="relative">
        <select ref={ref} id={fieldId} className={cn(CONTROL, 'h-11 appearance-none pr-10', className)} {...rest}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-500" />
      </div>
    </Shell>
  );
});

/** Segmented control. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn('inline-flex rounded-full bg-ink-900/6 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 rounded-full px-3.5 text-[13px] font-medium transition-all duration-200',
            value === o.value ? 'bg-card text-ink-950 shadow-sm' : 'text-ink-600 hover:text-ink-950',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- Surfaces ---------------------------------------------------------------------------------

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-3xl border hairline bg-card shadow-soft', className)} {...rest}>
      {children}
    </div>
  );
}

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brass' | 'dark';
const TONE: Record<Tone, string> = {
  neutral: 'bg-ink-900/6 text-ink-700',
  ok: 'bg-ok-50 text-ok-600',
  warn: 'bg-warn-50 text-warn-600',
  bad: 'bg-bad-50 text-bad-600',
  info: 'bg-info-50 text-info-600',
  brass: 'bg-brass-100 text-brass-700',
  dark: 'bg-ink-900 text-paper',
};

export function Badge({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium leading-none whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const BOOKING_TONE: Record<BookingStatus, [Tone, string]> = {
  BOOKED: ['info', 'Booked'],
  IN_PROGRESS: ['brass', 'In the chair'],
  COMPLETED: ['ok', 'Completed'],
  CANCELED: ['neutral', 'Canceled'],
  NO_SHOW: ['bad', 'No-show'],
};
const PAYMENT_TONE: Record<PaymentStatus, [Tone, string]> = {
  UNPAID: ['warn', 'Unpaid'],
  PAID: ['ok', 'Paid'],
  REFUNDING: ['info', 'Refunding'],
  REFUNDED: ['neutral', 'Refunded'],
};
const ORDER_TONE: Record<OrderStatus, [Tone, string]> = {
  CREATED: ['info', 'New'],
  IN_PROGRESS: ['brass', 'Preparing'],
  READY: ['ok', 'Ready to collect'],
  RECEIVED: ['neutral', 'Collected'],
  CANCELED: ['neutral', 'Canceled'],
};

export const BookingBadge = ({ status }: { status: BookingStatus }) => (
  <Badge tone={BOOKING_TONE[status][0]} dot>
    {BOOKING_TONE[status][1]}
  </Badge>
);
export const PaymentBadge = ({ status }: { status: PaymentStatus }) => (
  <Badge tone={PAYMENT_TONE[status][0]}>{PAYMENT_TONE[status][1]}</Badge>
);
export const OrderBadge = ({ status }: { status: OrderStatus }) => (
  <Badge tone={ORDER_TONE[status][0]} dot>
    {ORDER_TONE[status][1]}
  </Badge>
);
export const orderStatusLabel = (s: OrderStatus) => ORDER_TONE[s][1];

export function Avatar({
  person,
  src,
  size = 40,
  className,
}: {
  person: { firstName: string; lastName?: string | null };
  src?: string | null;
  size?: number;
  className?: string;
}) {
  return src ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full object-cover object-top ring-1 ring-ink-900/10', className)}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-ink-900 font-medium text-brass-200', className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials(person)}
    </span>
  );
}

// ---- Feedback ---------------------------------------------------------------------------------

/** The barber pole as a loader. */
export function Pole({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('pole inline-block h-10 w-3 animate-pole rounded-full ring-1 ring-ink-900/15', className)}
    />
  );
}

export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-ink-500">
      <Pole />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton', className)} aria-hidden />;

export function Empty({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-ink-900/5 text-ink-500 [&>svg]:size-6">
          {icon}
        </div>
      )}
      <h3 className="display text-2xl text-ink-950">{title}</h3>
      {children && <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-500">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode; className?: string }) {
  const Icon = tone === 'ok' ? Check : tone === 'info' ? Info : AlertCircle;
  return (
    <div className={cn('flex gap-3 rounded-2xl px-4 py-3 text-sm leading-relaxed', TONE[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 text-ink-800">{children}</div>
    </div>
  );
}

// ---- Dialog and sheet -------------------------------------------------------------------------

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** `sheet` slides in from the right and fills the height. */
  variant?: 'modal' | 'sheet';
  size?: 'sm' | 'md' | 'lg';
}

const WIDTH = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

export function Dialog({ open, onClose, title, description, children, footer, variant = 'modal', size = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'w-full overflow-hidden bg-card p-0 text-left text-ink-900 shadow-lift backdrop:bg-ink-950/50',
        variant === 'modal'
          ? ['modal m-auto max-h-[min(92dvh,880px)] rounded-[28px] max-sm:mb-0 max-sm:rounded-b-none', WIDTH[size]]
          : ['sheet mr-0 ml-auto h-dvh max-h-dvh', size === 'lg' ? 'max-w-xl' : 'max-w-md'],
      )}
    >
      {open && (
        <div className={cn('flex flex-col', variant === 'modal' ? 'max-h-[min(92dvh,880px)]' : 'h-dvh')}>
          <header className="flex items-start gap-4 px-6 pt-6 pb-4 sm:px-8 sm:pt-7">
            <div className="min-w-0 flex-1">
              {title && <h2 className="display text-[28px] text-ink-950">{title}</h2>}
              {description && <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{description}</p>}
            </div>
            <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2">
              <X className="size-5" />
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-8">{children}</div>
          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2.5 border-t hairline bg-ink-50/60 px-6 py-4 sm:px-8">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = 'Confirm',
  danger,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[15px] leading-relaxed text-ink-600">{children}</div>
    </Dialog>
  );
}

// ---- Toasts -----------------------------------------------------------------------------------

interface ToastItem {
  id: number;
  tone: 'ok' | 'bad' | 'info';
  message: string;
}
let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const push = (tone: ToastItem['tone'], message: string) => {
  const id = nextId++;
  toasts = [...toasts, { id, tone, message }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, tone === 'bad' ? 6500 : 4200);
};

export const toast = {
  success: (m: string) => push('ok', m),
  error: (m: string) => push('bad', m),
  info: (m: string) => push('info', m),
};

export function Toaster() {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  const ref = useRef<HTMLDivElement>(null);

  // A popover sits in the top layer, so toasts stay visible above open dialogs.
  useEffect(() => {
    const el = ref.current;
    if (!el?.showPopover) return;
    if (el.matches(':popover-open')) el.hidePopover();
    if (items.length) el.showPopover();
  }, [items]);

  return (
    <div
      ref={ref}
      popover="manual"
      aria-live="polite"
      className="pointer-events-none fixed inset-auto bottom-5 left-1/2 m-0 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2 overflow-visible border-0 bg-transparent p-0"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex animate-rise items-start gap-3 rounded-2xl bg-ink-900 px-4 py-3.5 text-sm text-paper shadow-lift"
        >
          <span
            className={cn(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
              t.tone === 'ok' ? 'bg-ok-600' : t.tone === 'bad' ? 'bg-bad-600' : 'bg-brass-500',
            )}
          >
            {t.tone === 'ok' ? <Check className="size-3" /> : t.tone === 'bad' ? <X className="size-3" /> : <Info className="size-3" />}
          </span>
          <p className="leading-snug">{t.message}</p>
        </div>
      ))}
    </div>
  );
}

// ---- Page chrome ------------------------------------------------------------------------------

export function PageHeader({ eyebrow, title, children, action }: { eyebrow?: string; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="display text-4xl text-ink-950 sm:text-5xl">{title}</h1>
        {children && <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ink-500">{children}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2.5">{action}</div>}
    </div>
  );
}
