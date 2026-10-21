/**
 * Line or Cable filter, a searchable asset list sorted by distance from the fix, and the loading,
 * empty and error states (`mobile-ui-spec.md` sections 3.8 and 6). Used by Tag and Tracking setup.
 */
import { useMemo } from 'react';

import type { Loaded } from '../app/useLineAssets';
import { listAssets } from '../core/assets';
import { formatDistance } from '../core/format';
import { LINE_KIND_LABEL, type LatLng, type LineAssetWithPoles, type LineType } from '../core/types';
import { Segmented } from './primitives';

const KIND_OPTIONS = [
  { value: 'SUTM' as const, label: LINE_KIND_LABEL.SUTM },
  { value: 'SKTM' as const, label: LINE_KIND_LABEL.SKTM },
];

const shortPole = (label: string | null): string => (label ?? '').replace(/^Tiang\s+/i, '');

export interface AssetPickerProps {
  assets: Loaded<LineAssetWithPoles[]>;
  onRetry: () => void;
  fix: LatLng | null;
  kind: LineType;
  onKind: (kind: LineType) => void;
  query: string;
  onQuery: (query: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AssetPicker({ assets, onRetry, fix, kind, onKind, query, onQuery, selectedId, onSelect }: AssetPickerProps) {
  const list = useMemo(
    () => (assets.status === 'ready' ? listAssets(assets.value, fix, kind, query) : []),
    [assets, fix, kind, query],
  );
  return (
    <div className="stack" style={{ gap: 10 }}>
      <Segmented label="Line or cable" options={KIND_OPTIONS} value={kind} onChange={onKind} />
      <div className="field">
        <label htmlFor="asset-search">Asset ID</label>
        <input
          id="asset-search"
          className="input input-mono"
          type="search"
          autoComplete="off"
          placeholder="Search, for example SUTM-PKL-02"
          value={query}
          onChange={(event) => {
            onQuery(event.target.value);
          }}
        />
      </div>
      {assets.status === 'loading' ? (
        <p className="helper" role="status" style={{ margin: 0 }}>
          Loading lines&hellip;
        </p>
      ) : assets.status === 'error' ? (
        <div className="banner banner-crit" role="alert">
          <span style={{ flex: 1 }}>{assets.message}</span>
          <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: 44 }} onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : list.length === 0 ? (
        <p className="helper" role="status" style={{ margin: 0 }}>
          {query.trim() === ''
            ? `There are no ${LINE_KIND_LABEL[kind].toLowerCase()} assets.`
            : `No ${LINE_KIND_LABEL[kind].toLowerCase()} matches “${query.trim()}”.`}
        </p>
      ) : (
        <div className="asset-list" role="radiogroup" aria-label="Line assets, nearest first">
          {list.map(({ asset, offsetM }) => (
            <button
              key={asset.id}
              type="button"
              role="radio"
              aria-checked={asset.id === selectedId}
              className="asset-item"
              onClick={() => {
                onSelect(asset.id);
              }}
            >
              <span className="mono asset-code">{asset.code}</span>
              <span className="helper asset-poles">
                {shortPole(asset.pole_a.label)} &ndash; {shortPole(asset.pole_b.label)}
                {offsetM === null ? '' : ` · ${formatDistance(offsetM)} away`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
