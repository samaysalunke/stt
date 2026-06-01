import { useEffect, useState } from 'react';

const DISMISS_KEY = 'stt_install_dismissed';
const DISMISS_TTL = 7 * 24 * 60 * 60 * 1000;

function isDismissed(): boolean {
  try {
    const ts = localStorage.getItem(DISMISS_KEY);
    if (!ts) return false;
    return Date.now() - Number(ts) < DISMISS_TTL;
  } catch {
    return false;
  }
}

function dismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {}
}

function isIOS(): boolean {
  return (
    /iphone|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

function isInStandaloneMode(): boolean {
  return (
    (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

const SLIDE_UP = `
  @keyframes stt-slide-up {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
`;

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    if (isDismissed() || isInStandaloneMode()) return;

    let captured: any = null;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      captured = e;
      setDeferredPrompt(e);
      setPlatform('android');
    };

    const handleInstalled = () => setShow(false);

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);

    const timer = setTimeout(() => {
      if (captured) {
        setShow(true);
      } else if (isIOS()) {
        setPlatform('ios');
        setShow(true);
      }
    }, 4000);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
      setDeferredPrompt(null);
      setShow(false);
      dismiss();
    });
  }

  async function handleIOSShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Seek the Thrill', url: window.location.href });
      } catch {
        // user cancelled share sheet — don't dismiss
      }
    }
  }

  function handleDismiss() {
    setShow(false);
    dismiss();
  }

  if (!show || !platform) return null;

  return (
    <>
      <style>{SLIDE_UP}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to Home Screen"
        style={{
          position: 'fixed',
          bottom: '5rem',
          left: '1rem',
          right: '1rem',
          zIndex: 9999,
          maxWidth: '420px',
          margin: '0 auto',
          background: '#fff',
          borderRadius: '1.25rem',
          boxShadow: '0 -2px 4px rgba(0,0,0,0.04), 0 16px 48px rgba(0,0,0,0.18)',
          fontFamily: 'inherit',
          overflow: 'hidden',
          animation: 'stt-slide-up 0.35s cubic-bezier(0.34,1.56,0.64,1) both',
        }}
      >
        {/* Orange accent bar */}
        <div style={{ height: '4px', background: 'linear-gradient(90deg,#FF6B35,#ff9a6c)' }} />

        <div style={{ padding: '1.25rem 1.25rem 1rem' }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', marginBottom: '1rem' }}>
            <img
              src="/logo.jpg"
              alt="Seek the Thrill"
              width={52}
              height={52}
              style={{ borderRadius: '12px', objectFit: 'cover', flexShrink: 0, border: '1px solid #f0f0f0' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: '#111', lineHeight: 1.2 }}>
                Seek the Thrill
              </div>
              <div style={{ fontSize: '0.78rem', color: '#666', marginTop: '0.2rem' }}>
                seekthethrill.in
              </div>
            </div>
            <button
              onClick={handleDismiss}
              aria-label="Dismiss"
              style={{
                background: '#f4f4f5',
                border: 'none',
                borderRadius: '50%',
                width: '30px',
                height: '30px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#888',
                fontSize: '0.85rem',
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>

          {/* Body */}
          {platform === 'android' ? (
            <>
              <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: '#444', lineHeight: 1.5 }}>
                Get quick access to trips, bookings and travel updates — right from your home screen.
              </p>
              <button
                onClick={handleInstall}
                style={{
                  width: '100%',
                  background: '#FF6B35',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.75rem',
                  padding: '0.8rem',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  letterSpacing: '0.01em',
                }}
              >
                Add to Home Screen
              </button>
              <button
                onClick={handleDismiss}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  color: '#999',
                  fontSize: '0.8rem',
                  marginTop: '0.6rem',
                  cursor: 'pointer',
                  padding: '0.25rem',
                }}
              >
                Not now
              </button>
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 0.875rem', fontSize: '0.88rem', color: '#444', lineHeight: 1.5 }}>
                Add this site to your home screen for a full app experience.
              </p>
              {/* Step hint */}
              <div
                style={{
                  background: '#fff7f3',
                  border: '1px solid #ffe0d0',
                  borderRadius: '0.75rem',
                  padding: '0.75rem 1rem',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  fontSize: '0.82rem',
                  color: '#555',
                }}
              >
                {/* iOS Share icon */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <path d="M8 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2"/>
                  <polyline points="15 3 12 0 9 3"/>
                  <line x1="12" y1="0" x2="12" y2="13"/>
                </svg>
                <span>
                  Tap <strong style={{ color: '#FF6B35' }}>Share</strong> at the bottom of your browser, then choose <strong style={{ color: '#FF6B35' }}>"Add to Home Screen"</strong>
                </span>
              </div>
              {/* Opens share sheet — closest to direct trigger on iOS */}
              <button
                onClick={handleIOSShare}
                style={{
                  width: '100%',
                  background: '#FF6B35',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.75rem',
                  padding: '0.8rem',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2"/>
                  <polyline points="15 3 12 0 9 3"/>
                  <line x1="12" y1="0" x2="12" y2="13"/>
                </svg>
                Open Share Menu
              </button>
              <button
                onClick={handleDismiss}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  color: '#999',
                  fontSize: '0.8rem',
                  marginTop: '0.6rem',
                  cursor: 'pointer',
                  padding: '0.25rem',
                }}
              >
                Not now
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
