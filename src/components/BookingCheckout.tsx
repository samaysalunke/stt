import { useState, useRef, useEffect } from 'react';

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
}

const C = {
  coral: '#E8725A',
  navy: '#1B2B3A',
  peach: '#E8DDD9',
  blush: '#FDF0EC',
  gray: '#6B7280',
  cta: '#D95F3B',
  border: '#e5e7eb',
};

const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

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

const inputCls = 'w-full px-4 py-3 border rounded-xl text-sm outline-none transition-all focus:border-[#E8725A] focus:shadow-[0_0_0_3px_rgba(232,114,90,0.15)] bg-white';

export default function BookingCheckout({
  slug, tripName, departure, offer, advanceAmount, balanceDueRule,
  upiId, bankAccountName, bankAccountNumber, bankBranch, bankIfsc,
  whatsappLink = 'https://wa.me/917975027491',
  isLoggedIn = false,
}: Props) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', age: '', gender: '',
    city: '', instagram: '', emergencyName: '', emergencyPhone: '', whyJoin: '',
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
  const [submitted, setSubmitted] = useState<null | 'pending' | 'lead'>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const perPerson = offer.price;
  const advanceDue = Math.min(advanceAmount, perPerson || advanceAmount);
  const balance = Math.max(0, perPerson - advanceDue);
  const dateStr = `${fmtDate(departure.startDate)} – ${fmtDate(departure.endDate)}`;

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
  }

  function validateStep2(): boolean {
    const required: [string, string][] = [
      ['fullName', 'Full Name'],
      ['email', 'Email'],
      ['phone', 'WhatsApp Number'],
      ['age', 'Age'],
      ['city', 'City'],
      ['emergencyName', 'Emergency Contact Name'],
      ['emergencyPhone', 'Emergency Contact Number'],
      ['whyJoin', 'Why do you want to join?'],
    ];
    const errs: Record<string, string> = {};
    for (const [field, label] of required) {
      if (!form[field as keyof typeof form].trim()) errs[field] = `${label} is required`;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Enter a valid email address';
    if (form.phone && !/^[\+\d][\d\s\-]{5,}$/.test(form.phone)) errs.phone = 'Enter a valid phone number';
    if (form.age) {
      const ageNum = Number(form.age);
      if (!Number.isInteger(ageNum) || ageNum < 16 || ageNum > 100) errs.age = 'Enter a valid age (16–100)';
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
  function goStep3() {
    if (!validateStep2()) return;
    history.pushState({ step: 3 }, '');
    setStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
        setSubmitted(withPayment ? 'pending' : 'lead');
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
            <span className="font-semibold text-sm" style={{ color: C.navy }}>{inr(perPerson)}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-3" style={{ background: C.blush }}>
            <div>
              <span className="text-sm font-semibold" style={{ color: C.coral }}>Advance now</span>
              <span className="text-xs block" style={{ color: C.gray }}>Pay today to confirm your spot</span>
            </div>
            <span className="font-bold" style={{ fontFamily: 'var(--font-display)', color: C.coral }}>{inr(advanceDue)}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <div>
              <span className="text-sm" style={{ color: C.gray }}>Balance before trip</span>
              <span className="text-xs block" style={{ color: C.gray }}>due {balanceDueRule}</span>
            </div>
            <span className="font-semibold text-sm" style={{ color: C.navy }}>{inr(balance)}</span>
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
        <div>
          <h3 className="font-bold text-base mb-4" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>Personal Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full Name" required error={errors.fullName} >
              <input type="text" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} className={inputCls} style={{ borderColor: errors.fullName ? C.coral : C.peach }} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Email ID" required error={errors.email}>
                <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputCls} style={{ borderColor: errors.email ? C.coral : C.peach }} />
              </Field>
            </div>
            <Field label="WhatsApp Number" required error={errors.phone}>
              <input type="tel" placeholder="+91 XXXXX XXXXX" value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} style={{ borderColor: errors.phone ? C.coral : C.peach }} />
            </Field>
            <Field label="How old are you?" required error={errors.age}>
              <input type="text" inputMode="numeric" placeholder="e.g. 24" value={form.age} onChange={(e) => set('age', e.target.value)} className={inputCls} style={{ borderColor: errors.age ? C.coral : C.peach }} />
            </Field>
            <Field label="Gender">
              <select value={form.gender} onChange={(e) => set('gender', e.target.value)} className={inputCls + ' bg-white cursor-pointer'} style={{ borderColor: C.peach }}>
                <option value="">Prefer not to say</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="City" required error={errors.city}>
              <input type="text" value={form.city} onChange={(e) => set('city', e.target.value)} className={inputCls} style={{ borderColor: errors.city ? C.coral : C.peach }} />
            </Field>
            <Field label="Instagram Handle (optional)">
              <input type="text" placeholder="@yourhandle" value={form.instagram} onChange={(e) => set('instagram', e.target.value)} className={inputCls} style={{ borderColor: C.peach }} />
            </Field>
          </div>
        </div>

        <hr style={{ borderColor: C.peach }} />

        <div>
          <h3 className="font-bold text-base mb-1" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>Emergency Contact</h3>
          <p className="text-xs mb-4" style={{ color: 'rgba(27,43,58,0.5)' }}>Someone we can reach if we can't get hold of you on the trip.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Their Name" required error={errors.emergencyName}>
              <input type="text" value={form.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} className={inputCls} style={{ borderColor: errors.emergencyName ? C.coral : C.peach }} />
            </Field>
            <Field label="Their Number" required error={errors.emergencyPhone}>
              <input type="tel" value={form.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} className={inputCls} style={{ borderColor: errors.emergencyPhone ? C.coral : C.peach }} />
            </Field>
          </div>
        </div>

        <hr style={{ borderColor: C.peach }} />

        <Field label="Why do you want to join this trip?" required error={errors.whyJoin}>
          <textarea
            rows={3}
            placeholder="No perfect answer. Tell us what pulled you here."
            value={form.whyJoin}
            onChange={(e) => set('whyJoin', e.target.value)}
            className={inputCls + ' resize-none'}
            style={{ borderColor: errors.whyJoin ? C.coral : C.peach }}
          />
        </Field>
      </div>

      <div className="mt-6">
        <button
          onClick={goStep3}
          className="w-full font-semibold text-white py-4 rounded-full text-base transition-all hover:opacity-90"
          style={{ background: C.cta }}
        >
          Continue to payment →
        </button>
      </div>
    </div>
  );

  // ── Step 3: Pay & Confirm ─────────────────────────────────────────────────────

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
        <h2 className="text-xl font-bold mb-2 text-center" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>Payment received.</h2>
        <p className="text-sm mb-5 text-center" style={{ color: C.gray }}>We're verifying your spot for:</p>
        <div className="rounded-xl px-5 py-4 mb-6 text-sm" style={{ background: C.blush, border: `1px solid ${C.peach}` }}>
          <p className="font-semibold mb-1" style={{ color: C.navy }}>{tripName}</p>
          <p style={{ color: C.gray }}>{dateStr} · {offer.label}</p>
        </div>
        <p className="text-sm leading-relaxed mb-2" style={{ color: C.navy }}>
          Your spot is confirmed once we verify your payment.
        </p>
        <p className="text-sm leading-relaxed mb-2" style={{ color: C.gray }}>
          We work through payments in order of receipt — usually within a few hours.
        </p>
        <p className="text-sm leading-relaxed" style={{ color: C.gray }}>
          You'll hear from us on WhatsApp once it's confirmed.
        </p>
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

  // Lead confirmation state
  if (submitted === 'lead') return (
    <div>
      <StepBar current={3} />
      <div className="py-4">
        <h2 className="text-xl font-bold mb-3" style={{ fontFamily: 'var(--font-display)', color: C.navy }}>
          You're registered — but your spot is not secured.
        </h2>
        <div className="rounded-xl px-5 py-4 mb-5 text-sm" style={{ background: C.blush, border: `1px solid ${C.peach}` }}>
          <p className="font-semibold mb-1" style={{ color: C.navy }}>{tripName}</p>
          <p style={{ color: C.gray }}>{dateStr} · {offer.label}</p>
        </div>
        <p className="text-sm leading-relaxed mb-1" style={{ color: C.navy }}>
          Spots are confirmed on payment only, first come.
        </p>
        <p className="text-sm leading-relaxed mb-6" style={{ color: C.gray }}>
          Pay the {inr(advanceDue)} advance to hold your place.
        </p>
        <button
          onClick={() => { setSubmitted(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          className="w-full font-semibold text-white py-4 rounded-full text-base transition-all hover:opacity-90 mb-4"
          style={{ background: C.cta }}
        >
          Pay now →
        </button>
        <p className="text-center text-sm" style={{ color: C.gray }}>
          Need help?{' '}
          <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: C.coral }}>
            Chat on WhatsApp
          </a>
        </p>
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

  // Payment reference hint
  const firstName = form.fullName.split(' ')[0] || 'YourName';
  const tripShort = tripName.split(' ')[0];
  const depDate = new Date(departure.startDate);
  const refExample = `${firstName} ${tripShort} ${depDate.toLocaleDateString('en-IN', { month: 'short' })}${depDate.getDate()}`;

  const hasBoth = !!(upiId && bankAccountNumber);

  return (
    <div>
      <StepBar current={3} />

      {/* Booking summary */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(27,43,58,0.4)' }}>Your booking</span>
          <button
            type="button"
            onClick={() => history.go(-2)}
            className="text-sm underline"
            style={{ color: C.coral }}
          >
            Change
          </button>
        </div>
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: C.peach }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: C.peach, background: C.blush }}>
            <span className="font-semibold text-sm" style={{ color: C.navy, fontFamily: 'var(--font-display)' }}>{tripName}</span>
          </div>
          {[
            { label: 'Departure', value: dateStr },
            { label: 'Room type', value: offer.label },
            { label: 'Per person', value: inr(perPerson) },
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
            Pay {inr(advanceDue)} advance via {hasBoth ? 'UPI or bank transfer' : upiId ? 'UPI' : 'bank transfer'}
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
                  'Open GPay, PhonePe, Paytm or any UPI app',
                  'Send to the UPI ID above',
                  `Pay exactly ${inr(advanceDue)} — the advance amount`,
                  'Screenshot the confirmation and upload below',
                ].map((s, i) => (
                  <div key={i} className="flex gap-2.5 items-start">
                    <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white font-medium mt-0.5" style={{ background: C.navy, fontSize: 10 }}>{i + 1}</span>
                    <span className="text-sm leading-snug" style={{ color: 'rgba(27,43,58,0.7)' }}>{s}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs pt-3" style={{ color: 'rgba(27,43,58,0.5)', borderTop: `1px solid ${C.peach}` }}>
                Use your name + trip as reference — e.g. <em>"{refExample}"</em>
              </p>
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
              <p className="text-xs mt-3 pt-3" style={{ color: 'rgba(27,43,58,0.5)', borderTop: `1px solid ${C.peach}` }}>
                Use your name + trip as reference — e.g. <em>"{refExample}"</em>
              </p>
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

      {/* Honesty line */}
      <p className="text-sm leading-relaxed mb-5" style={{ color: C.navy }}>
        Spots are confirmed only after we verify your payment, in order of receipt. Registering without paying does not hold a spot.
      </p>

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
        disabled={submitting !== null || uploadStatus !== 'done'}
        className="w-full font-semibold text-white py-4 rounded-full text-base transition-all hover:opacity-90 disabled:opacity-40 mb-4"
        style={{ background: C.cta }}
      >
        {submitting === 'payment' ? 'Submitting...' : 'Confirm my spot →'}
      </button>

      {/* Secondary action */}
      <button
        type="button"
        onClick={() => handleSubmit(false)}
        disabled={submitting !== null}
        className="w-full font-semibold py-4 rounded-full text-base transition-all hover:opacity-80 disabled:opacity-40"
        style={{ color: C.coral, border: `2px solid ${C.coral}`, background: 'transparent' }}
      >
        {submitting === 'lead' ? 'Submitting...' : 'Register without paying'}
      </button>
    </div>
  );
}
