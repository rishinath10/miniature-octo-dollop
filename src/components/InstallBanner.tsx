import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

const DISMISS_KEY = "dds-install-dismissed";
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

function dismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Nudges people to add the app to their home screen (needed for push on iPhone in Phase 2). */
export function InstallBanner() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => isStandalone() || dismissed());

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (hidden || (!evt && !isIos())) return null;
  const close = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl bg-gold-50 p-3 text-sm ring-1 ring-gold/30">
      <div className="flex-1">
        <div className="font-semibold">Install DDS Team on your phone</div>
        {evt ? (
          <div className="text-navy/70">Add it to your home screen for one-tap access.</div>
        ) : (
          <div className="text-navy/70">
            In Safari, tap the <b>Share</b> button (square with an arrow), then <b>Add to Home Screen</b>. (Needs iOS 16.4 or later for
            notifications.)
          </div>
        )}
      </div>
      {evt && (
        <button className="btn-primary px-3 py-1.5" onClick={() => evt.prompt().then(close)}>
          Install
        </button>
      )}
      <button className="text-navy/50" onClick={close} aria-label="Dismiss">✕</button>
    </div>
  );
}
