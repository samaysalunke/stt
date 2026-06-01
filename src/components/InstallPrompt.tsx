import { useEffect, useState } from 'react';

const DISMISS_KEY = 'stt_install_dismissed';
const DISMISS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

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
  // iPadOS 13+ reports as Macintosh; check maxTouchPoints to distinguish
  return (
    /iphone|ipod/i.test(navigator.userAgent) ||
    (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

function isInStandaloneMode(): boolean {
  return (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isDismissed() || isInStandaloneMode()) return;

    let prompt: any = null;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      prompt = e;
      setDeferredPrompt(e);
      setPlatform('android');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', () => setInstalled(true));

    const timer = setTimeout(() => {
      if (prompt) {
        setShow(true);
      } else if (isIOS()) {
        setPlatform('ios');
        setShow(true);
      }
    }, 4000);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  useEffect(() => {
    if (installed) setShow(false);
  }, [installed]);

  function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
      setDeferredPrompt(null);
      setShow(false);
      dismiss();
    });
  }

  function handleDismiss() {
    setShow(false);
    dismiss();
  }

  if (!show || !platform) return null;

  return (
    <div
      role="dialog"
      aria-label="Add to Home Screen"
      style={{
        position: 'fixed',
        bottom: '5.5rem',
        left: '1rem',
        right: '1rem',
        zIndex: 9999,
        borderRadius: '1rem',
        background: '#FF6B35',
        color: '#fff',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.875rem 1rem',
        fontFamily: 'inherit',
        maxWidth: '480px',
        margin: '0 auto',
      }}
    >
      {/* Icon */}
      <div style={{ flexShrink: 0 }}>
        {platform === 'android' ? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4"/>
            <path d="M8 8l4-4 4 4"/>
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
          </svg>
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        )}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.3 }}>
          Add to Home Screen
        </div>
        {platform === 'android' ? (
          <div style={{ fontSize: '0.78rem', opacity: 0.9, marginTop: '0.15rem' }}>
            Install the app for quick access to trips &amp; updates.
          </div>
        ) : (
          <div style={{ fontSize: '0.78rem', opacity: 0.9, marginTop: '0.15rem' }}>
            Tap the <strong>Share</strong> button{' '}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="white" style={{ display: 'inline', verticalAlign: 'middle' }} aria-hidden="true">
              <path d="M12 16V4M8 8l4-4 4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none"/>
            </svg>{' '}
            then <strong>"Add to Home Screen"</strong>.
          </div>
        )}
      </div>

      {/* CTA / Dismiss */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
        {platform === 'android' && (
          <button
            onClick={handleInstall}
            style={{
              background: '#fff',
              color: '#FF6B35',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.4rem 0.75rem',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Install
          </button>
        )}
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{
            background: 'rgba(255,255,255,0.2)',
            border: 'none',
            borderRadius: '50%',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            color: '#fff',
            fontSize: '1rem',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
