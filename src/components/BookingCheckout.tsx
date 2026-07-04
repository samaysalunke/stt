import { useState, useRef, useEffect } from 'react';
import { formatDateIN, formatINR } from '../lib/utils';
import { INDIA_CITIES } from '../lib/indiaCities';

interface Offer {
  tierId: string;
  label: string;
  helperText: string;
  price: number;
}
interface Departure {
  id: string;
  startDate: string;
  endDate: string;
}
interface Props {
  slug: string;
  tripName: string;
  departure: Departure;
  offer: Offer;
  advanceAmount: number;
  balanceDueRule: string;
  upiId: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankBranch: string;
  bankIfsc: string;
  whatsappLink?: string;
  isLoggedIn?: boolean;
  prefill?: Partial<Record<
    'fullName' | 'email' | 'phone' | 'age' | 'gender' | 'city' | 'instagram' | 'emergencyName' | 'emergencyPhone' | 'whyJoin',
    string
  >> | null;
  prefilledFromHistory?: boolean;
  initialRegistration?: {
    id: number;
    status: 'lead' | 'pending' | 'confirmed' | 'rejected';
    fullName?: string | null;
    whyJoin?: string | null;
    amountPaid?: number | null;
    totalAmount?: number | null;
  } | null;
}

const C = {
  coral: '#E8725A',
  navy: '#1B2B3A',
  peach: '#F5DDD7',
  blush: '#FDF0EC',
  gray: '#6B7280',
  cta: '#D95F3B',
  border: '#e5e7eb',
};


const STEPS = ['Your Trip', 'Your Details', 'Pay & Confirm'];

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center mb-8">
      {STEPS.map((label, i) => {
        const num = i + 1;
        const done = num < current;
        const active = num === current;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
                style={{
                  background: done || active ? C.coral : '#e5e7eb',
                  color: done || active ? 'white' : C.gray,
                }}
              >
                {done ? '✓' : num}
              </div>
              <span className="text-xs mt-1 text-center whitespace-nowrap" style={{ color: active ? C.navy : C.gray, fontWeight: active ? 600 : 400 }}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-0.5 mx-2 mb-5" style={{ background: done ? C.coral : '#e5e7eb' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label, required: req, children, error,
}: {
  label: string; required?: boolean; children: React.ReactNode; error?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5" style={{ color: C.navy }}>
        {label} {req && <span style={{ color: C.coral }}>*</span>}
      </label>
      {children}
      {error && <p className="text-xs mt-1" style={{ color: C.coral }}>{error}</p>}
    </div>
  );
}

// Controls are 16px on mobile (text-base) so iOS Safari doesn't zoom-on-focus —
// that zoom is what let the checkout page pan sideways. Desktop keeps 14px.
const inputCls = 'w-full px-4 py-3 border rounded-xl text-base sm:text-sm outline-none transition-all focus:border-[#E8725A] focus:shadow-[0_0_0_3px_rgba(232,114,90,0.15)] bg-white';

// Custom dropdown — a native <select> can't be styled (its arrow and open
// animation are OS-controlled and inconsistent). This matches the inputs, uses
// our own coral chevron, and animates open/close with a CSS transition.
function CustomSelect({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const selected = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={inputCls + ' flex items-center justify-between text-left cursor-pointer'}
        style={{ borderColor: C.peach }}
      >
        <span style={{ color: C.navy }}>{selected.label}</span>
        <svg
          className="w-4 h-4 ml-2 shrink-0 transition-transform duration-200"
          style={{ color: C.coral, transform: open ? 'rotate(180deg)' : 'none' }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <ul
        role="listbox"
        className="absolute left-0 right-0 z-20 mt-1.5 overflow-hidden rounded-xl border bg-white origin-top transition-all duration-150 ease-out"
        style={{
          borderColor: C.peach,
          boxShadow: '0 10px 30px -10px rgba(27,43,58,0.25)',
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.98)',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {options.map((o) => (
          <li
            key={o.value}
            role="option"
            aria-selected={o.value === value}
            onClick={() => { onChange(o.value); setOpen(false); }}
            className="px-4 py-2.5 text-sm cursor-pointer transition-colors"
            style={{ color: C.navy, background: o.value === value ? C.blush : 'white' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.blush; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = o.value === value ? C.blush : 'white'; }}
          >
            {o.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Searchable city picker: dropdown of Indian cities with an in-panel search box
// and an "Other" escape hatch that switches to free-text entry.
function CitySelect({
  value, onChange, onBlur, error,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [otherMode, setOtherMode] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); onBlur(); } }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = (q ? INDIA_CITIES.filter((c) => c.toLowerCase().includes(q)) : INDIA_CITIES).slice(0, 60);

  if (otherMode) {
    return (
      <div>
        <input
          type="text" autoFocus value={value} placeholder="Type your city"
          onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
          className={inputCls} style={{ borderColor: error ? C.coral : C.peach }}
        />
        <button type="button" onClick={() => setOtherMode(false)} className="text-xs mt-1.5 underline" style={{ color: C.coral }}>
          Choose from list instead
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={inputCls + ' flex items-center justify-between text-left cursor-pointer'}
        style={{ borderColor: error ? C.coral : C.peach }}
      >
        <span style={{ color: value ? C.navy : C.gray }}>{value || 'Select your city'}</span>
        <svg
          className="w-4 h-4 ml-2 shrink-0 transition-transform duration-200"
          style={{ color: C.coral, transform: open ? 'rotate(180deg)' : 'none' }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        role="listbox"
        className="absolute left-0 right-0 z-20 mt-1.5 rounded-xl border bg-white origin-top transition-all duration-150 ease-out"
        style={{
          borderColor: C.peach,
          boxShadow: '0 10px 30px -10px rgba(27,43,58,0.25)',
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(0.98)',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <div className="p-2 border-b" style={{ borderColor: C.peach }}>
          <input
            ref={searchRef} type="text" value={query} placeholder="Search city…"
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-base sm:text-sm outline-none"
            style={{ borderColor: C.peach }}
          />
        </div>
        <ul className="max-h-56 overflow-y-auto py-1">
          {filtered.map((c) => (
            <li
              key={c} role="option" aria-selected={c === value}
              onClick={() => { onChange(c); setQuery(''); setOpen(false); onBlur(); }}
              className="px-4 py-2 text-sm cursor-pointer transition-colors"
              style={{ color: C.navy, background: c === value ? C.blush : 'white' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.blush; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = c === value ? C.blush : 'white'; }}
            >
              {c}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-4 py-2 text-sm" style={{ color: C.gray }}>No match — choose “Other” below.</li>
          )}
        </ul>
        <button
          type="button"
          onClick={() => { if (INDIA_CITIES.includes(value)) onChange(''); setQuery(''); setOpen(false); setOtherMode(true); }}
          className="w-full text-left px-4 py-2.5 text-sm border-t cursor-pointer"
          style={{ borderColor: C.peach, color: C.coral, fontWeight: 600 }}
        >
          Other — type my city
        </button>
      </div>
    </div>
  );
}

export default function BookingCheckout({
  slug, tripName, departure, offer, advanceAmount, balanceDueRule,
  upiId, bankAccountName, bankAccountNumber, bankBranch, bankIfsc,
  whatsappLink = 'https://wa.me/917975027491',
  isLoggedIn = false,
  prefill = null,
  prefilledFromHistory = false,
  initialRegistration = null,
}: Props) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', age: '', gender: '',
    city: '', instagram: '', emergencyName: '', emergencyPhone: '', whyJoin: '',
    // Returning travellers get their details prefilled (whyJoin stays per-trip).
    ...(prefill ?? {}),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [uploadName, setUploadName] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeCancel, setAgreeCancel] = useState(false);
  const [submitting, setSubmitting] = useState<null | 'payment' | 'lead'>(null);
  const [submitError, setSubmitError] = useState('');
  const [payTab, setPayTab] = useState<'upi' | 'bank'>('upi');
  const [uploadError, setUploadError] = useState('');
  const initialSubmitted =
    initialRegistration?.status === 'lead' || initialRegistration?.status === 'pending' || initialRegistration?.status === 'confirmed'
      ? initialRegistration.status
      : null;
  const [submitted, setSubmitted] = useState<null | 'pending' | 'lead' | 'confirmed'>(initialSubmitted);
  const fileRef = useRef<HTMLInputElement>(null);

  // A resumed pending/confirmed registration already locked in an amount when it was
  // paid — show that, not whatever tier the current URL/departure happens to resolve to.
  const perPerson =
    (initialRegistration?.status === 'pending' || initialRegistration?.status === 'confirmed') && initialRegistration.totalAmount
      ? initialRegistration.totalAmount
      : offer.price;
  const advanceDue = Math.min(advanceAmount, perPerson || advanceAmount);
  const balance = Math.max(0, perPerson - advanceDue);
  const dateStr = `${formatDateIN(departure.startDate)} – ${formatDateIN(departure.endDate)}`;

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
  }

  // Single source of truth for field rules. Used both at the step gate and
  // on blur so travellers get feedback as they go, not just on submit.
  const LABELS: Record<string, string> = {
    fullName: 'Full Name', email: 'Email', phone: 'WhatsApp Number', age: 'Age',
    city: 'City', emergencyName: 'Emergency Contact Name',
    emergencyPhone: 'Emergency Contact Number', whyJoin: 'Why do you want to join?',
  };
  const REQUIRED = ['fullName', 'email', 'phone', 'age', 'city', 'emergencyName', 'emergencyPhone', 'whyJoin'];

  function fieldError(field: string, raw: string): string {
    const value = (raw ?? '').trim();
    if (REQUIRED.includes(field) && !value) return `${LABELS[field]} is required`;
    if (!value) return ''; // optional + empty → ok

    const digits = value.replace(/\D/g, '');
    switch (field) {
      case 'fullName':
      case 'emergencyName':
        if (value.length < 2 || !/[a-zA-Z]/.test(value)) return 'Enter a valid name';
        return '';
      case 'email':
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Enter a valid email address';
      case 'phone':
      case 'emergencyPhone':
        if (!/^[+\d][\d\s-]+$/.test(value) || digits.length < 8 || digits.length > 15) return 'Enter a valid phone number';
        return '';
      case 'age': {
        const n = Number(value);
        return Number.isInteger(n) && n >= 16 && n <= 100 ? '' : 'Enter a valid age (16–100)';
      }
      case 'city':
        return value.length >= 2 ? '' : 'Enter a valid city';
      case 'instagram':
        return /^@?[A-Za-z0-9._]{1,30}$/.test(value) ? '' : 'Enter a valid Instagram handle';
      case 'whyJoin':
        return value.length >= 10 ? '' : 'Tell us a little more (at least 10 characters)';
      default:
        return '';
    }
  }

  function handleBlur(field: string) {
    const err = fieldError(field, form[field as keyof typeof form]);
    setErrors((prev) => {
      const n = { ...prev };
      if (err) n[field] = err; else delete n[field];
      return n;
    });
  }

  function validateStep2(): boolean {
    const errs: Record<string, string> = {};
    for (const field of [...REQUIRED, 'instagram']) {
      const err = fieldError(field, form[field as keyof typeof form]);
      if (err) errs[field] = err;
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  useEffect(() => {
    history.replaceState({ step: 1 }, '');
    function onPopState(e: PopStateEvent) {
      const s = (e.state?.step as number) ?? 1;
      setStep(s);
      setSubmitted(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function goStep2() {
    history.pushState({ step: 2 }, '');
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function goStep3() {
    if (!validateStep2()) return;
    setSubmitError('');
    setSubmitting('lead');
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripSlug: slug,
          tripName,
          batchId: departure.id,
          tierId: offer.tierId,
          sharingOption: offer.label,
          tripDate: dateStr,
          totalAmount: perPerson,
          paymentScreenshotUrl: '',
          intent: 'details',
          ...form,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.status === 'pending' || data.status === 'confirmed') {
          setSubmitted(data.status);
        } else {
          setSubmitted(null);
          history.pushState({ step: 3 }, '');
          setStep(3);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setSubmitError(data.error ?? 'Something went wrong. Please try again.');
      }
    } catch {
      setSubmitError('Network error. Please check your connection.');
    } finally {
      setSubmitting(null);
    }
  }

  async function handleUpload(file: File) {
    setUploadStatus('uploading');
    setUploadName(file.name);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.url) {
        setScreenshotUrl(data.url);
        setUploadStatus('done');
      } else {
        setUploadStatus('error');
      }
    } catch {
      setUploadStatus('error');
    }
  }

  function removeUpload() {
    setScreenshotUrl('');
    setUploadStatus('idle');
    setUploadName('');
    setUploadError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSubmit(withPayment: boolean) {
    if (withPayment && uploadStatus !== 'done') {
      setUploadError('Please upload your payment screenshot to confirm your spot.');
      return;
    }
    if (!agreeTerms || !agreeCancel) {
      setSubmitError('Please accept the Terms and Cancellation Policy to continue.');
      return;
    }
    setSubmitError('');
    setUploadError('');
    setSubmitting(withPayment ? 'payment' : 'lead');
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripSlug: slug,
          tripName,
          batchId: departure.id,
          tierId: offer.tierId,
          sharingOption: offer.label,
          tripDate: dateStr,
          totalAmount: perPerson,
          paymentScreenshotUrl: withPayment ? screenshotUrl : '',
          agreeTerms: true,
          agreeCancel: true,
          ...form,
        }),
      });
      const data = await res.json();
      if (data.success) {
        if (typeof (window as any).gtag === 'function') {
          (window as any).gtag('event', 'submit_registration', { trip_slug: slug });
        }
        setSubmitted((data.status === 'pending' || data.status === 'confirmed' || data.status === 'lead') ? data.status : (withPayment ? 'pending' : 'lead'));
      } else {
        setSubmitError(data.error ?? 'Something went wrong. Please try again.');
        setSubmitting(null);
      }
    } catch {
      setSubmitError('Network error. Please check your connection.');
      setSubmitting(null);
    }
  }

  async function copyToClipboard(text: string, btn: HTMLButtonElement) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:absolute;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    const orig = btn.textContent ?? '';
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  }

  // ── Step 1: Review ────────────────────────────────────────────────────────────
  if (step === 1) return (
    <div>
      <StepBar current={1} />
      <div className="rounded-2xl overflow-hidden border mb-6" style={{ borderColor: C.peach }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: C.peach, background: C.blush }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: C.gray }}>Trip</div>
          <div className="font-semibold" style={{ color: C.navy, fontFamily: 'var(--font-display)' }}>{tripName}</div>
        </div>
        <div className="px-5 py-4 border-b" style={{ borderColor: C.peach }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: C.gray }}>Dates</div>
          <div className="font-medium text-sm" style={{ color: C.navy }}>{dateStr}</div>
        </div>
        <div className="px-5 py-4 border-b" style={{ borderColor: C.peach }}>
          <div className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: C.gray }}>Occupancy</div>
          <div className="font-medium text-sm" style={{ color: C.navy }}>{offer.label}</div>
        </div>
        <div className="divide-y" style={{ borderColor: C.peach }}>
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-sm" style={{ color: C.gray }}>Per person</span>
            <span className="font-semibold text-sm" style={{ color: C.navy }}>{formatINR(perPerson)}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-3" style={{ background: C.blush }}>
            <div>
              <span className="text-sm font-semibold" style={{ color: C.coral }}>Advance now</span>
              <span className="text-xs block" style={{ color: C.gray }}>Pay today to confirm your spot</span>
            </div>
            <span className="font-bold" style={{ fontFamily: 'var(--font-display)', color: C.coral }}>{formatINR(advanceDue)}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <div>
              <span className="text-sm" style={{ color: C.gray }}>Balance before trip</span>
              <span className="text-xs block" style={{ color: C.gray }}>due {balanceDueRule}</span>
            </div>
            <span className="font-semibold text-sm" style={{ color: C.navy }}>{formatINR(balance)}</span>
          </div>
        </div>
      </div>
      <p className="text-xs mb-6 px-1" style={{ color: C.gray }}>Advance is non-refundable once paid.</p>
      <button
        onClick={goStep2}
        className="w-full font-semibold text-white py-4 rounded-full text-base transition-all hover:opacity-90"
        style={{ background: C.cta }}
      >
        Continue to your details →
      </button>
    </div>
  );

  // ── Step 2: Details ───────────────────────────────────────────────────────────
  if (step === 2) return (
    <div>
      <StepBar current={2} />
      <div className="space-y-5">
        {prefilledFromHistory && (
          <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm" style={{ background: C.blush, color: C.navy }}>
            <svg className="w-4 h-4 mt-0.5 shrink-0" style={{ color: C.coral }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Welcome back — we’ve filled in your details from last time. Give them a quick check and update anything that’s changed.</span>
          </div>
        )}
        <div>
          <h3 className="font-bold text-base mb-4" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>Personal Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full Name" required error={errors.fullName} >
              <input type="text" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} onBlur={() => handleBlur('fullName')} className={inputCls} style={{ borderColor: errors.fullName ? C.coral : C.peach }} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Email ID" required error={errors.email}>
                <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} onBlur={() => handleBlur('email')} className={inputCls} style={{ borderColor: errors.email ? C.coral : C.peach }} />
              </Field>
            </div>
            <Field label="WhatsApp Number" required error={errors.phone}>
              <input type="tel" placeholder="+91 XXXXX XXXXX" value={form.phone} onChange={(e) => set('phone', e.target.value)} onBlur={() => handleBlur('phone')} className={inputCls} style={{ borderColor: errors.phone ? C.coral : C.peach }} />
              <p className="text-xs mt-1.5" style={{ color: C.gray }}>This is how Zahra reaches you — and how we hold your spot if you need a minute to pay.</p>
            </Field>
            <Field label="How old are you?" required error={errors.age}>
              <input type="text" inputMode="numeric" placeholder="e.g. 24" value={form.age} onChange={(e) => set('age', e.target.value)} onBlur={() => handleBlur('age')} className={inputCls} style={{ borderColor: errors.age ? C.coral : C.peach }} />
            </Field>
            <Field label="Gender">
              <CustomSelect
                value={form.gender}
                onChange={(v) => set('gender', v)}
                options={[
                  { value: '', label: 'Prefer not to say' },
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                  { value: 'other', label: 'Other' },
                ]}
              />
            </Field>
            <Field label="City" required error={errors.city}>
              <CitySelect value={form.city} onChange={(v) => set('city', v)} onBlur={() => handleBlur('city')} error={!!errors.city} />
            </Field>
            <Field label="Instagram Handle (optional)" error={errors.instagram}>
              <input type="text" placeholder="@yourhandle" value={form.instagram} onChange={(e) => set('instagram', e.target.value)} onBlur={() => handleBlur('instagram')} className={inputCls} style={{ borderColor: errors.instagram ? C.coral : C.peach }} />
            </Field>
          </div>
        </div>

        <hr style={{ borderColor: C.peach }} />

        <div>
          <h3 className="font-bold text-base mb-1" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>Emergency Contact</h3>
          <p className="text-xs mb-4" style={{ color: 'rgba(27,43,58,0.5)' }}>Someone we can reach if we can't get hold of you on the trip.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Their Name" required error={errors.emergencyName}>
              <input type="text" value={form.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} onBlur={() => handleBlur('emergencyName')} className={inputCls} style={{ borderColor: errors.emergencyName ? C.coral : C.peach }} />
            </Field>
            <Field label="Their Number" required error={errors.emergencyPhone}>
              <input type="tel" value={form.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} onBlur={() => handleBlur('emergencyPhone')} className={inputCls} style={{ borderColor: errors.emergencyPhone ? C.coral : C.peach }} />
            </Field>
          </div>
        </div>

        <hr style={{ borderColor: C.peach }} />

        <Field label="Why do you want to join this trip?" required error={errors.whyJoin}>
          <p className="text-xs mb-2" style={{ color: C.gray }}>We read every one — it's how we keep the group feeling right. Not a test, just helps us know who's coming.</p>
          <textarea
            rows={3}
            placeholder="No perfect answer. Tell us what pulled you here."
            value={form.whyJoin}
            onChange={(e) => set('whyJoin', e.target.value)}
            onBlur={() => handleBlur('whyJoin')}
            className={inputCls + ' resize-none'}
            style={{ borderColor: errors.whyJoin ? C.coral : C.peach }}
          />
        </Field>
      </div>

      <div className="mt-6">
        {submitError && (
          <div className="mb-4 p-4 rounded-xl text-sm" style={{ background: '#fee2e2', color: '#991b1b' }}>{submitError}</div>
        )}
        <button
          onClick={goStep3}
          disabled={submitting !== null}
          className="w-full font-semibold text-white py-4 rounded-full text-base transition-all hover:opacity-90"
          style={{ background: C.cta }}
        >
          {submitting === 'lead' ? 'Saving...' : 'Continue to payment →'}
        </button>
      </div>
    </div>
  );

  // ── Step 3: Pay & Confirm ─────────────────────────────────────────────────────
  const firstName = (form.fullName || initialRegistration?.fullName || 'Traveller').trim().split(/\s+/)[0] || 'Traveller';

  // Pending confirmation state
  if (submitted === 'pending') return (
    <div>
      <StepBar current={3} />
      <div className="py-4">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5" style={{ background: C.blush }}>
          <svg className="w-8 h-8" style={{ color: C.coral }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold mb-2 text-center" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>Got it — we're verifying your payment.</h2>
        <p className="text-sm mb-5 text-center" style={{ color: C.gray }}>Your screenshot is in. Zahra checks these in order of receipt and confirms on WhatsApp, usually within a few hours.</p>
        <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: C.blush, border: `1px solid ${C.peach}` }}>
          <p className="font-semibold mb-1" style={{ color: C.navy }}>{tripName}</p>
          <p style={{ color: C.gray }}>{dateStr} · {offer.label}</p>
          <p className="mt-3 text-sm font-semibold" style={{ color: '#D97706' }}>Status: Payment under review</p>
        </div>
        <p className="text-sm leading-relaxed mb-2" style={{ color: C.navy }}>
          Your spot is confirmed only once we've verified the transfer — we'll message you the moment it's done.
        </p>
        <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="block w-full text-center font-semibold text-white py-3.5 rounded-full text-sm mt-6" style={{ background: '#25D366' }}>
          Message Zahra on WhatsApp
        </a>
        {!isLoggedIn && (
          <div className="mt-6 rounded-xl px-5 py-4 text-center" style={{ background: C.blush, border: `1px solid ${C.peach}` }}>
            <p className="text-sm font-semibold mb-1" style={{ color: C.navy }}>Track your adventures</p>
            <p className="text-xs mb-3" style={{ color: C.gray }}>Sign in to see your km from home and join the leaderboard.</p>
            <a href="/api/auth/google" className="inline-block text-sm font-semibold px-5 py-2 rounded-full text-white" style={{ background: C.coral }}>
              Sign in with Google →
            </a>
          </div>
        )}
      </div>
    </div>
  );

  if (submitted === 'confirmed') return (
    <div>
      <StepBar current={3} />
      <div className="py-4">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5" style={{ background: '#D1FAE5' }}>
          <svg className="w-8 h-8" style={{ color: '#16a34a' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold mb-2 text-center" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>You're in. Spot confirmed.</h2>
        <p className="text-sm mb-5 text-center" style={{ color: C.gray }}>Zahra verified your advance. Your seat on {tripName} is held — welcome aboard.</p>
        <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: C.blush, border: `1px solid ${C.peach}` }}>
          <p className="font-semibold mb-1" style={{ color: C.navy }}>{dateStr} · {offer.label}</p>
          <p className="mt-3 font-semibold" style={{ color: '#16a34a' }}>Paid — {formatINR(advanceDue)} advance ✓</p>
          <p className="mt-1" style={{ color: C.gray }}>Balance {formatINR(balance)} — due {balanceDueRule}</p>
        </div>
        <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="block w-full text-center font-semibold text-white py-3.5 rounded-full text-sm" style={{ background: '#25D366' }}>
          Join the trip WhatsApp group
        </a>
      </div>
    </div>
  );

  // Lead confirmation state
  if (submitted === 'lead') return (
    <div>
      <StepBar current={3} />
      <div className="py-4">
        <h2 className="text-xl font-bold mb-3" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>
          We're holding your details, {firstName}.
        </h2>
        <p className="text-sm leading-relaxed mb-5" style={{ color: C.gray }}>
          You're registered for {tripName} — but the spot isn't confirmed until the advance lands. No rush from us, just know it's first paid, first in.
        </p>
        <div className="rounded-xl px-5 py-4 mb-5 text-sm" style={{ background: C.blush, border: `1px solid ${C.peach}` }}>
          <p className="font-semibold mb-1" style={{ color: C.navy }}>{tripName}</p>
          <p style={{ color: C.gray }}>{dateStr} · {offer.label}</p>
          <p className="mt-3 font-semibold" style={{ color: C.coral }}>To confirm — {formatINR(advanceDue)} advance</p>
        </div>
        <button
          onClick={() => { setSubmitted(null); setStep(3); history.pushState({ step: 3 }, ''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          className="w-full font-semibold text-white py-4 rounded-full text-base transition-all hover:opacity-90 mb-4"
          style={{ background: C.cta }}
        >
          Pay now & confirm →
        </button>
        <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="block w-full text-center font-semibold py-3.5 rounded-full text-sm mb-4" style={{ color: '#128C7E', border: '1px solid #25D366' }}>
          Question first? Chat with Zahra
        </a>
        <p className="text-xs text-center" style={{ color: C.gray }}>We'll send a gentle nudge on WhatsApp if we don't hear back — no spam, promise.</p>
        {!isLoggedIn && (
          <div className="mt-6 rounded-xl px-5 py-4 text-center" style={{ background: C.blush, border: `1px solid ${C.peach}` }}>
            <p className="text-sm font-semibold mb-1" style={{ color: C.navy }}>Track your adventures</p>
            <p className="text-xs mb-3" style={{ color: C.gray }}>Sign in to see your km from home and join the leaderboard.</p>
            <a href="/api/auth/google" className="inline-block text-sm font-semibold px-5 py-2 rounded-full text-white" style={{ background: C.coral }}>
              Sign in with Google →
            </a>
          </div>
        )}
      </div>
    </div>
  );

  const hasBoth = !!(upiId && bankAccountNumber);

  return (
    <div>
      <StepBar current={3} />
      <div className="mb-5">
        <h2 className="text-xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>Confirm your spot</h2>
        <p className="text-sm" style={{ color: C.gray }}>You're registered. Pay the {formatINR(advanceDue)} advance to confirm your spot.</p>
      </div>
      <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm mb-5" style={{ background: C.blush, color: C.navy, border: `1px solid ${C.peach}` }}>
        <svg className="w-4 h-4 mt-0.5 shrink-0" style={{ color: C.coral }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>You're registered as {firstName}. This spot isn't held yet — first paid, first confirmed.</span>
      </div>

      {/* Booking summary */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(27,43,58,0.4)' }}>Your booking</span>
        </div>
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: C.peach }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: C.peach, background: C.blush }}>
            <span className="font-semibold text-sm" style={{ color: C.navy, fontFamily: 'var(--font-display)' }}>{tripName}</span>
          </div>
          {[
            { label: 'Departure', value: dateStr },
            { label: 'Room type', value: offer.label },
            { label: 'Per person', value: formatINR(perPerson) },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between px-4 py-2.5 border-b last:border-0" style={{ borderColor: C.peach }}>
              <span className="text-xs" style={{ color: C.gray }}>{label}</span>
              <span className="text-sm font-medium" style={{ color: C.navy }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* How to pay */}
      {(upiId || bankAccountNumber) && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold mb-1" style={{ color: C.navy }}>How to pay</h3>
          <p className="text-sm mb-3" style={{ color: C.gray }}>
            Pay {formatINR(advanceDue)} advance via {hasBoth ? 'UPI or bank transfer' : upiId ? 'UPI' : 'bank transfer'}
          </p>

          {hasBoth && (
            <div className="flex rounded-xl p-1 mb-3" style={{ background: 'rgba(27,43,58,0.07)' }}>
              {(['upi', 'bank'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setPayTab(tab)}
                  className="flex-1 text-center py-2 rounded-lg text-sm font-medium transition-all"
                  style={payTab === tab
                    ? { background: 'white', color: C.navy, boxShadow: '0 1px 3px rgba(27,43,58,0.08)' }
                    : { color: 'rgba(27,43,58,0.5)' }}
                >
                  {tab === 'upi' ? 'Pay via UPI' : 'Bank Transfer'}
                </button>
              ))}
            </div>
          )}

          {(!hasBoth || payTab === 'upi') && upiId && (
            <div className="rounded-xl p-4 text-sm" style={{ background: C.blush }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'rgba(27,43,58,0.38)' }}>UPI ID</p>
              <div className="flex items-center justify-between rounded-xl px-3.5 py-2.5 mb-4" style={{ background: 'rgba(217,95,59,0.06)', border: '1px solid rgba(217,95,59,0.25)' }}>
                <span className="text-sm font-medium" style={{ color: C.coral, wordBreak: 'break-all' }}>{upiId}</span>
                <button
                  type="button"
                  onClick={(e) => copyToClipboard(upiId, e.currentTarget)}
                  className="ml-3 shrink-0 flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md transition-all"
                  style={{ border: '0.5px solid rgba(217,95,59,0.45)', color: C.coral }}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  Copy
                </button>
              </div>
              <div className="space-y-2.5 mb-3">
                {[
                  `Pay ${formatINR(advanceDue)} (the advance) to the UPI ID above`,
                  'Screenshot the confirmation and upload below',
                ].map((s, i) => (
                  <div key={i} className="flex gap-2.5 items-start">
                    <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white font-medium mt-0.5" style={{ background: C.navy, fontSize: 10 }}>{i + 1}</span>
                    <span className="text-sm leading-snug" style={{ color: 'rgba(27,43,58,0.7)' }}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!hasBoth || payTab === 'bank') && bankAccountNumber && (
            <div className="rounded-xl p-4 text-sm" style={{ background: C.blush }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'rgba(27,43,58,0.38)' }}>Bank Account Details</p>
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  {[
                    { label: 'Account name', value: bankAccountName },
                    { label: 'Account no.', value: bankAccountNumber, copy: true },
                    { label: 'Branch', value: bankBranch },
                    { label: 'IFSC', value: bankIfsc, copy: true },
                  ].map(({ label, value, copy }) => (
                    <tr key={label} style={{ borderBottom: '0.5px solid rgba(27,43,58,0.07)' }}>
                      <td className="py-2 pr-3 text-xs" style={{ color: 'rgba(27,43,58,0.48)' }}>{label}</td>
                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs font-medium" style={{ color: C.navy }}>{value}</span>
                          {copy && value && (
                            <button
                              type="button"
                              onClick={(e) => copyToClipboard(value, e.currentTarget)}
                              className="text-xs font-medium px-2 py-0.5 rounded-md transition-all"
                              style={{ border: '0.5px solid rgba(27,43,58,0.22)', color: 'rgba(27,43,58,0.55)' }}
                            >
                              Copy
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Screenshot upload */}
      <div className="mb-5">
        <label className="block text-sm font-medium mb-0.5" style={{ color: C.navy }}>
          Upload payment screenshot
        </label>
        <p className="text-xs mb-2" style={{ color: C.gray }}>A screenshot or photo of your UPI confirmation is fine.</p>
        <div
          onClick={() => uploadStatus !== 'done' && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (uploadStatus !== 'done') (e.currentTarget as HTMLDivElement).style.borderColor = C.coral; }}
          onDragLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = uploadError ? C.coral : C.border; }}
          onDrop={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLDivElement).style.borderColor = C.border;
            if (e.dataTransfer.files[0] && uploadStatus !== 'done') { setUploadError(''); handleUpload(e.dataTransfer.files[0]); }
          }}
          className="border-2 border-dashed rounded-xl p-6 text-center transition-colors"
          style={{
            borderColor: uploadStatus === 'done' ? '#22c55e' : uploadError ? C.coral : C.border,
            cursor: uploadStatus === 'done' ? 'default' : 'pointer',
          }}
        >
          {uploadStatus === 'done' ? (
            <div className="flex items-center justify-between">
              <p className="text-sm" style={{ color: '#16a34a' }}>✓ {uploadName}</p>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeUpload(); }}
                className="text-xs ml-3 underline"
                style={{ color: C.gray }}
              >
                Remove
              </button>
            </div>
          ) : uploadStatus === 'uploading' ? (
            <p className="text-sm" style={{ color: C.gray }}>Uploading...</p>
          ) : (
            <>
              <svg className="w-7 h-7 mx-auto mb-2" style={{ color: C.gray }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm" style={{ color: C.gray }}>Tap to upload screenshot</p>
              <p className="text-xs mt-1" style={{ color: C.gray }}>JPG, PNG, PDF up to 5MB</p>
            </>
          )}
        </div>
        {uploadStatus === 'error' && <p className="text-xs mt-1" style={{ color: C.coral }}>Upload failed — try again.</p>}
        {uploadError && <p className="text-xs mt-1" style={{ color: C.coral }}>{uploadError}</p>}
        <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) { setUploadError(''); handleUpload(e.target.files[0]); } }} />
      </div>

      {/* Trust line */}
      <p className="text-xs leading-relaxed rounded-lg px-4 py-3 mb-5" style={{ background: 'rgba(27,43,58,0.03)', border: `1px solid ${C.peach}`, color: 'rgba(27,43,58,0.6)' }}>
        Run by Zahra and a small team who've actually done these routes. Real humans, one WhatsApp away.
      </p>

      {/* Legal */}
      <div className="space-y-3 mb-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={agreeTerms} onChange={(e) => { setAgreeTerms(e.target.checked); setSubmitError(''); }} className="mt-0.5" />
          <span className="text-sm" style={{ color: C.navy }}>
            I agree to the <a href="/terms/" target="_blank" className="underline" style={{ color: C.coral }}>Terms and Conditions</a> <span style={{ color: C.coral }}>*</span>
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={agreeCancel} onChange={(e) => { setAgreeCancel(e.target.checked); setSubmitError(''); }} className="mt-0.5" />
          <span className="text-sm" style={{ color: C.navy }}>
            I have read the <a href="/cancellation/" target="_blank" className="underline" style={{ color: C.coral }}>Cancellation Policy</a> <span style={{ color: C.coral }}>*</span>
          </span>
        </label>
      </div>

      {submitError && (
        <div className="mb-4 p-4 rounded-xl text-sm" style={{ background: '#fee2e2', color: '#991b1b' }}>{submitError}</div>
      )}

      {/* Primary action */}
      <button
        onClick={() => handleSubmit(true)}
        disabled={submitting !== null || uploadStatus !== 'done' || !agreeTerms || !agreeCancel}
        className="w-full font-semibold text-white py-4 rounded-full text-base transition-all hover:opacity-90 disabled:opacity-40 mb-4"
        style={{ background: C.cta }}
      >
        {submitting === 'payment' ? 'Submitting...' : 'Confirm my spot →'}
      </button>

      {/* Secondary action */}
      <button
        type="button"
        onClick={() => { setSubmitted('lead'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        disabled={submitting !== null}
        className="w-full text-sm transition-all hover:opacity-80 disabled:opacity-40"
        style={{ color: C.coral, background: 'transparent' }}
      >
        I'll pay later
      </button>
    </div>
  );
}
