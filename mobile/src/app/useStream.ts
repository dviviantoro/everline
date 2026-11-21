/**
 * Keeps the Cantol's stream running while a screen that needs it is open (Live, free walk). If the
 * Cantol cannot be told to start, the error is kept for the screen to show with a retry; the stream
 * also starts by itself once a link that was down as the screen opened comes back.
 */
import { useCallback, useEffect, useState } from 'react';

import { useWizard } from './wizard';

export function useStream(): { startError: string | null; begin: () => void } {
  const { state, startMeasurement } = useWizard();
  const [startError, setStartError] = useState<string | null>(null);
  const begin = useCallback(() => {
    startMeasurement().then(
      () => {
        setStartError(null);
      },
      (error: unknown) => {
        setStartError(error instanceof Error && error.message !== '' ? error.message : 'The Cantol could not be told to start.');
      },
    );
  }, [startMeasurement]);
  const { streaming } = state;
  const isLinked = state.cantol === 'linked';
  useEffect(() => {
    if (!streaming && isLinked) begin();
  }, [streaming, isLinked, begin]);
  return { startError, begin };
}
