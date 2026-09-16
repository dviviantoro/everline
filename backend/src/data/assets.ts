import { query } from "../db";
import { worstSeverity } from "../severity";
import type { Asset, AssetListItem, AssetType, Condition, Severity } from "../types";

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
  const conditionsBySurvey = new Map<string, Condition | null>();
  const severitiesBySurvey = new Map<string, Severity[]>();

  if (latestSurveyIds.length > 0) {
    const readings = await query<{ survey_id: string; condition: Condition | null }>(
      "select survey_id, condition from transformer_readings where survey_id = any($1)",
      [latestSurveyIds]
    );
    for (const r of readings) conditionsBySurvey.set(r.survey_id, r.condition);

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

  return assets.map((asset) => {
    const latest = latestByAsset.get(asset.id);
    const latest_condition: Condition | null = latest ? conditionsBySurvey.get(latest.id) ?? null : null;
    const latest_severity: Severity | null = latest
      ? worstSeverity(severitiesBySurvey.get(latest.id) ?? [])
      : null;

    return {
      ...asset,
      last_surveyed_at: latest?.surveyed_at ?? null,
      ...(asset.type === "transformer" ? { latest_condition } : { latest_severity }),
    };
  });
}
