/** What every screen that shows the live stream says about it: test data, and a Start that failed. */
import { AlertIcon } from './icons';

export function StreamNotices({ synthetic, startError, onRetry }: { synthetic: boolean; startError: string | null; onRetry: () => void }) {
  return (
    <>
      {synthetic ? (
        <div className="banner" role="status" aria-label="Test data">
          <AlertIcon size={20} />
          <span style={{ flex: 1 }}>
            <strong>Test data.</strong> The Cantol says these numbers are generated, not measured.
          </span>
        </div>
      ) : null}
      {startError === null ? null : (
        <div className="banner banner-crit" role="alert">
          <AlertIcon size={20} />
          <span style={{ flex: 1 }}>The Cantol did not start sending. {startError}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </>
  );
}
