/**
 * The field build's `Services`: the real hotspot, Cantol link and GPS behind the same interfaces
 * the demo simulates (ADR-008). Live PD works (ADR-010: the Cantol streams pulses, which the
 * Rust codec turns into dBmV). Recording, tagging, tracking and upload are not part of this
 * release: the survey API is absent and the Live screen says so (`surveysNote`).
 */
import type { AppConfig, Services } from '../app/services';
import { PD_DEVICE } from '../app/services';
import { createSetupSource } from '../core/cantolSetup';
import type { Dsp } from '../core/dsp';
import type { LinkCodec } from '../core/linkCodec';
import type { SurveyApi } from '../core/links';
import type { AppStore } from '../core/store';
import { createFieldGnss, type GeolocationApi } from '../native/fieldGnss';
import { createFieldHotspot } from '../native/fieldHotspot';
import { createFieldLink } from '../native/fieldLink';
import type { NativePlugins } from '../native/plugins';
import type { LoadedProfile } from './deviceProfile';

export const FIELD_SURVEYS_NOTE =
  'Recording, tagging a point on a line and upload need the survey server, which this version is not connected to yet. Nothing here is saved.';

function unavailable<T>(): Promise<T> {
  return Promise.reject(new Error('Surveys cannot be loaded or uploaded in this release.'));
}

/** Nothing here is reachable (the screens that call it are not offered), and it fails loudly if one ever is. */
const noSurveyApi: SurveyApi = {
  listLineAssets: () => unavailable(),
  listMeasurementPoints: () => unavailable(),
  uploadSurvey: () => unavailable(),
};

export interface FieldDeps {
  dsp: Dsp;
  codec: LinkCodec;
  store: AppStore;
  profile: LoadedProfile;
  plugins: NativePlugins;
  geolocation: GeolocationApi;
  now?: () => number;
}

export function createFieldServices(deps: FieldDeps): Services {
  const now = deps.now ?? (() => Date.now());
  const { profile } = deps.profile;
  const setup = createSetupSource(deps.store);
  const config: AppConfig = {
    badge: null,
    signIn: { note: null, skipAs: null },
    recordSeconds: () => 60,
    uploadedLabel: 'Uploaded',
    footerLinks: [],
    extraRoutes: [],
    pdDevice: PD_DEVICE,
    shellExtras: null,
    surveysNote: FIELD_SURVEYS_NOTE,
  };
  return {
    config,
    dsp: deps.dsp,
    hotspot: createFieldHotspot(deps.plugins.hotspot, profile.band, setup),
    setup,
    link: createFieldLink({
      native: deps.plugins.link,
      codec: deps.codec,
      tcpPort: profile.tcpPort,
      beaconPort: profile.beaconPort,
      expectedMac: () => setup.current()?.mac ?? null,
      now,
    }),
    gnss: createFieldGnss(deps.geolocation, deps.plugins.gnss, now),
    api: noSurveyApi,
    store: deps.store,
    now,
  };
}
