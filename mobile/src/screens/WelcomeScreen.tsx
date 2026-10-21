/**
 * Screen 1b: the logo animation after sign-in (`mobile-ui-spec.md` section 3.1, design system
 * section 6). It advances to the first unmet wizard step once the animation has ended AND the
 * app has finished initialising (`destination` is null until then), after a short moment on the
 * "Signed in" status. With reduced motion it shows the final frame and advances after about
 * 600 ms. The Continue button stays available once the animation has ended.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { ArrowRightIcon, CheckIcon } from '../ui/icons';
import { BrandMark, TopBar } from '../ui/primitives';
import { useReducedMotion } from '../ui/useReducedMotion';

const ANIMATION_MS = 2900;
const REDUCED_MOTION_MS = 600;
/** After the animation ends the "Signed in" status stays readable for a moment before advancing. */
const SETTLE_MS = 450;

export function WelcomeScreen({ destination }: { destination: string | null }) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const [animationDone, setAnimationDone] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAnimationDone(true);
    }, reduced ? REDUCED_MOTION_MS : ANIMATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [reduced]);

  useEffect(() => {
    if (!animationDone) return undefined;
    const timer = window.setTimeout(() => {
      setSettled(true);
    }, reduced ? 0 : SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [animationDone, reduced]);

  const ready = settled && destination !== null;
  useEffect(() => {
    if (ready) void navigate(destination, { replace: true });
  }, [ready, destination, navigate]);

  return (
    <div className="screen" style={{ overflow: 'hidden' }}>
      <TopBar />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="splash-stage" aria-hidden="true">
          <div className="splash-glow" />
          <div className="splash-ring" />
          <div className="splash-ring r2" />
          <div className="splash-logo">
            <BrandMark size={104} />
          </div>
        </div>

        <div className="splash-word" role="img" aria-label="EverLine">
          Ever<span className="accent">Line</span>
        </div>

        <svg className="splash-trace-wrap" width="200" height="36" viewBox="0 0 200 36" style={{ marginTop: 14 }} aria-hidden="true">
          <path
            className="splash-trace"
            pathLength={1}
            d="M0 28 L58 28 L80 8 L120 8 L142 28 L200 28"
            fill="none"
            style={{ stroke: 'var(--cyan)', strokeDasharray: 1, strokeDashoffset: 0 }}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle className="splash-dot" cx="100" cy="8" r="5" style={{ fill: 'var(--ok)' }} />
        </svg>
      </div>

      <div style={{ minHeight: 132, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 14 }}>
        <div className="splash-status" aria-live="polite">
          {animationDone ? (
            <span className="rise-in" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--ok-text)' }}>
              <CheckIcon size={16} />
              Signed in
            </span>
          ) : (
            <span style={{ color: 'var(--cyan-text)' }}>Signing you in&hellip;</span>
          )}
        </div>
        <div className="splash-bar" aria-hidden="true">
          <span />
        </div>
        <div style={{ minHeight: 56 }}>
          {animationDone ? (
            <button
              type="button"
              className="btn btn-primary rise-in"
              style={{ width: '100%' }}
              disabled={destination === null}
              onClick={() => {
                if (destination) void navigate(destination, { replace: true });
              }}
            >
              Continue
              <ArrowRightIcon size={18} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
