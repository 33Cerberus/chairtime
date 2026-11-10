import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { FormEvent, ReactNode, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Logo } from '../components/Layouts';
import { Button, Input, Notice, toast } from '../components/ui';
import { api, ApiError, errorMessage, Session } from '../lib/api';
import { homeFor, useAuth } from '../lib/auth';

/** Pulls field-level messages out of a 400 response. */
function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {};
  return Object.fromEntries((e.details as { field: string; errors: string[] }[]).map((d) => [d.field, d.errors[0]]));
}

function AuthShell({ title, lead, children, footer }: { title: ReactNode; lead: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <aside className="grain relative isolate hidden flex-col justify-between overflow-hidden bg-ink-950 p-12 text-paper lg:flex">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: 'radial-gradient(70% 60% at 20% 100%, rgb(193 151 73 / 0.28), transparent 70%)' }}
        />
        <Logo light />
        <div>
          <p className="display max-w-md text-6xl">
            “A good barber <span className="text-brass-300 italic">remembers</span> how you like it.”
          </p>
          <p className="mt-6 text-sm text-ink-400">So does your account — every visit, in one place.</p>
        </div>
        <div className="pole h-1.5 w-24 rounded-full" />
      </aside>
      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
          <h1 className="display animate-rise text-5xl text-ink-950 sm:text-6xl">{title}</h1>
          <p className="mt-3 animate-rise text-[15px] leading-relaxed text-ink-500 [animation-delay:60ms]">{lead}</p>
          <div className="mt-9 animate-rise [animation-delay:120ms]">{children}</div>
          {footer && <div className="mt-8 text-sm text-ink-500">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

function useAfterSignIn() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return (session: Session) => {
    signIn(session);
    navigate(from ?? homeFor(session.user), { replace: true });
  };
}

// Shown only by the dev server: one-click sign-in as each seeded role.
const DEMO = import.meta.env.DEV
  ? [
      ['Client', '+48600000021'],
      ['Barber', '+48600000011'],
      ['Front desk', '+48600000002'],
      ['Owner', '+48600000001'],
    ]
  : [];
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD ?? 'chairtime-demo';

export function LoginPage() {
  const { user, ready } = useAuth();
  const location = useLocation();
  const after = useAfterSignIn();
  const [phoneNumber, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: (body: { phoneNumber: string; password: string }) => api<Session>('/auth/login', { method: 'POST', body }),
    onSuccess: after,
  });
  const errors = fieldErrors(login.error);

  if (ready && user && !login.isSuccess) return <Navigate to={homeFor(user)} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ phoneNumber, password });
  };

  return (
    <AuthShell
      title={
        <>
          Welcome <span className="italic">back.</span>
        </>
      }
      lead="Sign in with the phone number you booked with."
      footer={
        <>
          New here?{' '}
          <Link to="/register" state={location.state} className="font-medium text-ink-950 underline underline-offset-4">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {login.error && !Object.keys(errors).length && <Notice tone="bad">{errorMessage(login.error)}</Notice>}
        <Input label="Phone number" type="tel" autoComplete="tel" inputMode="tel" placeholder="600 100 200" value={phoneNumber} onChange={(e) => setPhone(e.target.value)} error={errors.phoneNumber} required autoFocus />
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} required />
        <div className="text-right">
          <Link to="/reset-password" className="text-[13px] text-ink-500 underline-offset-4 hover:text-ink-950 hover:underline">
            Forgot your password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={login.isPending}>
          Sign in <ArrowRight className="size-4" />
        </Button>
      </form>

      {DEMO.length > 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-ink-900/15 p-4">
          <p className="eyebrow mb-3">Demo accounts · development only</p>
          <div className="flex flex-wrap gap-2">
            {DEMO.map(([label, phone]) => (
              <button
                key={phone}
                type="button"
                onClick={() => login.mutate({ phoneNumber: phone, password: DEMO_PASSWORD })}
                className="h-9 rounded-full border border-ink-900/12 bg-card px-3.5 text-[13px] font-medium text-ink-800 hover:border-ink-900/40"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, ready } = useAuth();
  const location = useLocation();
  const after = useAfterSignIn();
  const [form, setForm] = useState({ firstName: '', lastName: '', phoneNumber: '', email: '', password: '' });
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState<{ devCode?: string } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const register = useMutation({
    mutationFn: () =>
      api<Session>('/auth/register', {
        method: 'POST',
        body: { ...form, email: form.email.trim() || undefined, ...(needsCode && code ? { code } : {}) },
      }),
    onSuccess: (session) => {
      toast.success(needsCode ? 'Welcome back — your past visits are now in your account.' : `Welcome, ${session.user.firstName}.`);
      after(session);
    },
    onError: (e) => {
      // The shop already has a record under this number: prove the phone is yours to claim it.
      if (e instanceof ApiError && e.code === 'PHONE_VERIFICATION_REQUIRED') {
        setNeedsCode((e.details as { devCode?: string } | undefined) ?? {});
      }
    },
  });
  const errors = fieldErrors(register.error);
  const verifying = register.error instanceof ApiError && register.error.code === 'PHONE_VERIFICATION_REQUIRED';

  if (ready && user && !register.isSuccess) return <Navigate to={homeFor(user)} replace />;

  return (
    <AuthShell
      title={
        needsCode ? (
          <>
            Confirm <span className="italic">it is you.</span>
          </>
        ) : (
          <>
            Create your <span className="italic">account.</span>
          </>
        )
      }
      lead={
        needsCode
          ? `We already have visits under ${form.phoneNumber}. Enter the 6-digit code we sent there and they will appear in your account.`
          : 'It takes a minute, and then booking takes less.'
      }
      footer={
        <>
          Already have one?{' '}
          <Link to="/login" state={location.state} className="font-medium text-ink-950 underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          register.mutate();
        }}
        className="space-y-4"
        noValidate
      >
        {register.error && !verifying && !Object.keys(errors).length && <Notice tone="bad">{errorMessage(register.error)}</Notice>}
        {needsCode ? (
          <>
            {needsCode.devCode && (
              <Notice tone="info">
                Development mode: no SMS gateway is connected, so the code is shown here — <strong className="tnum font-semibold">{needsCode.devCode}</strong>
              </Notice>
            )}
            <Input
              label="Verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              className="tnum text-center text-xl tracking-[0.5em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              error={errors.code}
              autoFocus
            />
            <Button type="submit" size="lg" className="w-full" loading={register.isPending} disabled={code.length !== 6}>
              Confirm and continue
            </Button>
            <button type="button" className="w-full text-center text-[13px] text-ink-500 hover:text-ink-950" onClick={() => { setNeedsCode(null); setCode(''); register.reset(); }}>
              Use a different number
            </button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Input label="First name" autoComplete="given-name" value={form.firstName} onChange={set('firstName')} error={errors.firstName} required autoFocus />
              <Input label="Last name" autoComplete="family-name" value={form.lastName} onChange={set('lastName')} error={errors.lastName} required />
            </div>
            <Input label="Phone number" type="tel" autoComplete="tel" inputMode="tel" placeholder="600 100 200" value={form.phoneNumber} onChange={set('phoneNumber')} error={errors.phoneNumber} hint="We use it for reminders and to find your booking." required />
            <Input label="E-mail (optional)" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
            <Input label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="At least 8 characters." required />
            <Button type="submit" size="lg" className="w-full" loading={register.isPending}>
              Create account <ArrowRight className="size-4" />
            </Button>
          </>
        )}
      </form>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const after = useAfterSignIn();
  const [phoneNumber, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState<{ devCode?: string } | null>(null);

  const request = useMutation({
    mutationFn: () => api<{ devCode?: string }>('/auth/password-reset/request', { method: 'POST', body: { phoneNumber } }),
    onSuccess: setSent,
  });
  const reset = useMutation({
    mutationFn: () => api<Session>('/auth/password-reset', { method: 'POST', body: { phoneNumber, code, password } }),
    onSuccess: (session) => {
      toast.success('Password changed. You are signed in.');
      after(session);
    },
  });
  const error = request.error ?? reset.error;
  const errors = fieldErrors(error);

  return (
    <AuthShell
      title={
        <>
          Reset your <span className="italic">password.</span>
        </>
      }
      lead={sent ? 'If that number has an account, a 6-digit code is on its way. It expires in 10 minutes.' : 'Enter your phone number and we will text you a code.'}
      footer={
        <Link to="/login" className="font-medium text-ink-950 underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sent ? reset.mutate() : request.mutate();
        }}
        className="space-y-4"
        noValidate
      >
        {error && !Object.keys(errors).length && <Notice tone="bad">{errorMessage(error)}</Notice>}
        {!sent ? (
          <>
            <Input label="Phone number" type="tel" autoComplete="tel" inputMode="tel" placeholder="600 100 200" value={phoneNumber} onChange={(e) => setPhone(e.target.value)} error={errors.phoneNumber} required autoFocus />
            <Button type="submit" size="lg" className="w-full" loading={request.isPending}>
              Send the code
            </Button>
          </>
        ) : (
          <>
            {sent.devCode && (
              <Notice tone="info">
                Development mode: no SMS gateway is connected, so the code is shown here — <strong className="tnum font-semibold">{sent.devCode}</strong>
              </Notice>
            )}
            <Input label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="tnum text-center text-xl tracking-[0.5em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={errors.code} autoFocus />
            <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="At least 8 characters." />
            <Button type="submit" size="lg" className="w-full" loading={reset.isPending} disabled={code.length !== 6}>
              Change password
            </Button>
          </>
        )}
      </form>
    </AuthShell>
  );
}

export function SetPasswordPage() {
  const [params] = useSearchParams();
  const after = useAfterSignIn();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const mismatch = repeat.length > 0 && repeat !== password;

  const submit = useMutation({
    mutationFn: () => api<Session>('/auth/set-password', { method: 'POST', body: { token, password } }),
    onSuccess: (session) => {
      toast.success(`Welcome aboard, ${session.user.firstName}.`);
      after(session);
    },
  });
  const errors = fieldErrors(submit.error);

  return (
    <AuthShell
      title={
        <>
          Choose your <span className="italic">password.</span>
        </>
      }
      lead="This link works once. After that you sign in with your phone number and the password you set here."
    >
      {!token ? (
        <Notice tone="bad">This link is incomplete. Ask the shop for a new one.</Notice>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch) submit.mutate();
          }}
          className="space-y-4"
          noValidate
        >
          {submit.error && !Object.keys(errors).length && <Notice tone="bad">{errorMessage(submit.error)}</Notice>}
          <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="At least 8 characters." autoFocus />
          <Input label="Repeat it" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} error={mismatch ? 'The passwords do not match' : undefined} />
          <Button type="submit" size="lg" className="w-full" loading={submit.isPending} disabled={!password || mismatch}>
            Save and sign in
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
