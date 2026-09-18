import { query } from "../db";
import { worstSeverity } from "../severity";
import type { Asset, AssetListItem, AssetType, Condition, Severity } from "../types";

// Latest transformer reading, flattened onto each list row so map markers can
// show measurements on hover without one request per transformer.
interface TransformerReadingRow {
  survey_id: string;
  condition: Condition | null;
  load_percent: number | null;
  oil_temp_c: number | null;
  voltage_secondary_v: number | null;
}

export async function getAssetList(type?: AssetType | null): Promise<AssetListItem[]> {
  const assets =
    type === "transformer" || type === "line"
      ? await query<Asset>("select * from assets where type = $1", [type])
      : await query<Asset>("select * from assets");

  const surveys = await query<{ id: string; asset_id: string; surveyed_at: string }>(
    "select id, asset_id, surveyed_at from surveys order by surveyed_at desc"
  );

  // surveys is ordered newest-first, so the first occurrence per asset_id is its latest.
  const latestByAsset = new Map<string, { id: string; asset_id: string; surveyed_at: string }>();
  for (const survey of surveys) {
    if (!latestByAsset.has(survey.asset_id)) latestByAsset.set(survey.asset_id, survey);
  }

  const latestSurveyIds = [...latestByAsset.values()].map((s) => s.id);
  const readingBySurvey = new Map<string, TransformerReadingRow>();
  const severitiesBySurvey = new Map<string, Severity[]>();

  if (latestSurveyIds.length > 0) {
    const readings = await query<TransformerReadingRow>(
      `select survey_id, condition, load_percent, oil_temp_c, voltage_secondary_v
       from transformer_readings where survey_id = any($1)`,
      [latestSurveyIds]
    );
    for (const r of readings) readingBySurvey.set(r.survey_id, r);

    const points = await query<{ survey_id: string; severity: Severity | null }>(
      "select survey_id, severity from pd_readings where survey_id = any($1)",
      [latestSurveyIds]
    );
    for (const p of points) {
      const list = severitiesBySurvey.get(p.survey_id) ?? [];
      if (p.severity) list.push(p.severity);
      severitiesBySurvey.set(p.survey_id, list);
    }
  }

  // Full load% history per transformer, oldest-first, for the marker popup's
  // trend graph — the lookups above only ever read the newest survey.
  const historyByAsset = new Map<string, { surveyed_at: string; load_percent: number | null }[]>();
  const historyRows = await query<{ asset_id: string; surveyed_at: string; load_percent: number | null }>(
    `select s.asset_id, s.surveyed_at, tr.load_percent
     from transformer_readings tr
     join surveys s on s.id = tr.survey_id
     order by s.surveyed_at asc`
  );
  for (const r of historyRows) {
    const list = historyByAsset.get(r.asset_id) ?? [];
    list.push({ surveyed_at: r.surveyed_at, load_percent: r.load_percent });
    historyByAsset.set(r.asset_id, list);
  }

  return assets.map((asset) => {
    const latest = latestByAsset.get(asset.id);
    const reading = latest ? readingBySurvey.get(latest.id) : undefined;
    const latest_severity: Severity | null = latest
      ? worstSeverity(severitiesBySurvey.get(latest.id) ?? [])
      : null;

    return {
      ...asset,
      last_surveyed_at: latest?.surveyed_at ?? null,
      ...(asset.type === "transformer"
        ? {
            latest_condition: reading?.condition ?? null,
            latest_load_percent: reading?.load_percent ?? null,
            latest_oil_temp_c: reading?.oil_temp_c ?? null,
            latest_voltage_secondary_v: reading?.voltage_secondary_v ?? null,
            history: historyByAsset.get(asset.id) ?? [],
          }
        : { latest_severity }),
    };
  });
}
