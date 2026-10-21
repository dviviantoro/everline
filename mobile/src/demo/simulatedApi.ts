/**
 * Simulated survey API. It makes no network request and holds no key: it answers from the
 * fixtures, and an "upload" is just a reply (HTTP 201 with a made-up survey id, or a failure
 * when the demo control asks for one). Nothing leaves the phone.
 */
import type { SurveyApi, UploadResult } from '../core/links';
import type { SurveyPayload } from '../core/model';
import type { LineAssetWithPoles, MeasurementPoint } from '../core/types';
import type { ControlsStore } from './controls';
import type { DemoLine } from './fixtures';
import { uuidFromLabel } from './prng';

const LATENCY_MS = 350;

function later<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve(value);
    }, LATENCY_MS);
  });
}

/** A line asset as the API would return it: no demo-only fields. */
function asAsset(line: DemoLine): LineAssetWithPoles {
  return {
    id: line.id,
    type: line.type,
    code: line.code,
    name: line.name,
    line_type: line.line_type,
    conductor_type: line.conductor_type,
    route_geometry: line.route_geometry,
    pole_a_id: line.pole_a_id,
    pole_b_id: line.pole_b_id,
    pole_a: line.pole_a,
    pole_b: line.pole_b,
  };
}

export class SimulatedApi implements SurveyApi {
  private uploads = 0;

  constructor(
    private readonly lines: readonly DemoLine[],
    private readonly controls: ControlsStore,
  ) {}

  listLineAssets(): Promise<LineAssetWithPoles[]> {
    return later(this.lines.map(asAsset));
  }

  listMeasurementPoints(assetId: string): Promise<MeasurementPoint[]> {
    const line = this.lines.find((l) => l.id === assetId);
    return later(line ? line.points.map((p) => ({ ...p })) : []);
  }

  uploadSurvey(assetId: string, body: SurveyPayload): Promise<UploadResult> {
    this.uploads += 1;
    if (this.controls.get().failNextUpload) {
      this.controls.set({ failNextUpload: false });
      return later({
        status: 500,
        surveyId: null,
        message: 'Demo: this upload was set to fail. Nothing was sent anywhere.',
      });
    }
    const known = this.lines.some((l) => l.id === assetId);
    if (!known) return later({ status: 404, surveyId: null, message: 'Demo: unknown asset.' });
    if (body.points.length === 0) return later({ status: 400, surveyId: null, message: 'Demo: a survey needs a point.' });
    return later({
      status: 201,
      surveyId: uuidFromLabel(`survey:${assetId}:${String(this.uploads)}`),
      message: null,
    });
  }
}
