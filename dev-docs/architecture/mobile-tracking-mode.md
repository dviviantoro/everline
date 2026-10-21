# Mobile tracking mode (`mobile/`)

> Status: design, not started. Task: TASK-011 (after TASK-006 and TASK-007). Visual reference: `dev-docs/design/mobile/mock/TrackSetup.dc.html` and `Tracking.dc.html`. Screen contract: `mobile-ui-spec.md` section 3.7. Decision record: ADR-006.
>
> Every number marked "Assumption" is a placeholder the product has not set (`planning/PROJECT_BRIEF.md` section 16). Flag any change to them in the CHANGELOG.

---

## 1) What the feature is

Spot reading answers "what is the PD level here". Tracking mode answers "where along this span is it strongest, and am I getting closer or further away". The operator carries the Cantol sensor along one line asset (one span between two poles). The phone shows the PD magnitude now, whether it is rising or falling, and a chart of magnitude against position. At the end the operator saves the walk as one survey.

Only line assets are tracked (overhead `SUTM` or cable `SKTM`). A span is short and has a fixed layout, which the app uses instead of free-form distance marks (section 2).

---

## 2) Stations: how marks map to the data model

A span has two end poles and three measurement points sited at 25, 50 and 75 percent of the route (`backend/src/geo.ts`, fractions `[0.25, 0.5, 0.75]`). Tracking uses those five **stations** in order:

| Station | Chainage | Becomes in the survey |
|---|---|---|
| Pole A | 0 % | a point without `measurement_point_id`, `point_label` "Pole A" |
| P1 | 25 % | `measurement_point_id` of the 25 % point |
| P2 | 50 % | `measurement_point_id` of the 50 % point |
| P3 | 75 % | `measurement_point_id` of the 75 % point |
| Pole B | 100 % | a point without `measurement_point_id`, `point_label` "Pole B" |

Sequence numbers follow the walk order (1 to 5). Walking from B to A is allowed: the operator sets the direction on the setup screen and the app reverses the order; labels and ids stay attached to their stations.

The mock's M1 to M4 at 45 m spacing is illustrative. The real number of marks per walk is up to five and the distances come from the route geometry, not from a constant.

### Position source (setup choice)

| Source | Mock label | Behaviour |
|---|---|---|
| Station marks | "Point marks" | The operator taps **Mark station** when standing at a pole or measurement point. The app assigns the next station. This is the default and the only source that works without a good GPS fix. |
| GPS distance | "GPS distance" | The app projects each GPS fix onto the line's `route_geometry` to get chainage in metres and draws the chart continuously. Stations are marked automatically when the chainage passes them (within 5 m, Assumption) and the operator can still tap **Mark station**. Requires accuracy at or below 10 m (Assumption); otherwise fall back to station marks and say so. |

---

## 3) Signal processing (pure, in WASM)

All of this is pure computation and belongs in `cantol-dsp`, exported through `cantol-wasm`, with golden vectors (same rule as `classify`). The TypeScript side only renders. No threshold is written in TypeScript.

| Step | Definition | Status |
|---|---|---|
| Sample | One value per second: the window statistic of PD events in that second, converted to dBmV with the calibration constants. Statistic = window peak unless open question 1 in `mobile-ui-spec.md` decides otherwise. | Assumption |
| Live level | Mean of the last 3 samples, dBmV. Drives the big number and the severity colour through `classify`. | Assumption |
| Live trend | Compare the live level with the mean of the 3 samples before it. Difference at or above +1.5 dB is **Rising**, at or below -1.5 dB is **Falling**, otherwise **Steady**. | Assumption |
| Mark value | At a mark, the statistic over the last 5 s before the tap (the dwell at the station). | Assumption |
| Segment trend | Between consecutive marks: value difference at or above +3 dB is Rising, at or below -3 dB is Falling, otherwise Steady. | Assumption |
| Peak | The highest mark value and its station. | Derived |
| Guidance | If the live level is more than 6 dB below the peak, the card says to go back to the peak station with its distance and value. If the live level is within 3 dB of the peak, it says "At the strongest reading". Otherwise it shows the trend text only. | Assumption |

All differences are in **dB** (a difference of two dBmV values), not dBmV. The mock's "+22 mV" becomes "+22 dB".

Each rule needs a golden vector with the boundary values (exactly +1.5, -1.5, +3, -3, 6, 3), and the vectors are what the dashboard and the phone must both agree on if the trend is ever shown on the web.

If pulse events are not available (open question 2 in `mobile-ui-spec.md`) and Cantol sends final numbers only, the sample is that number and everything else in this table still holds.

---

## 4) Screens

### Setup (`/track/setup`)

- Asset kind: Line or Cable (filters by `line_type`). Asset: searchable list of line assets; show code and the two pole labels.
- Direction: "A to B" or "B to A" (pole labels).
- Position source (section 2).
- Warning level: three presets, 20, 30 and 40 dBmV (20 and 40 are the provisional warning and critical bounds). When the live level reaches the chosen level the screen gives a one-time alert (visual banner, haptic, optional sound).
- Sound cue switch (default off; the mock shows it on). Pitch rises with level. The audio context starts from the Start tracking tap (user gesture).
- Status strip: Cantol streaming and current noise floor in dBmV.
- Start tracking is disabled until Cantol is streaming and a GPS fix exists.

### Tracking (`/track`)

- Header: asset code, direction, distance walked or stations marked.
- Big number: live level in dBmV, with the station label it applies to. Next to it a trend chip: arrow plus "Rising", "Falling" or "Steady". The meaning never relies on colour alone (arrow, word and colour together).
- Guidance card (section 3).
- Chart: x = chainage (or station index), y = dBmV, a horizontal line at the warning level, a marker at the peak, the current position highlighted. Accessible name states the numbers in words (as the mock does).
- Segment list: one row per consecutive pair of marks with the trend word and the dB difference.
- Actions: **Mark station** and **Finish** (confirm first). Back button asks before leaving.
- Link lost: keep all marks, show the link-lost banner, resume on reconnect. If the link is lost for more than 30 s the walk stays in Dexie as a draft and the wizard opens.

---

## 5) Saving

Finish creates one local `Measurement` of mode `tracking` in Dexie containing the ordered marks, then continues to `/tag` with the asset already chosen (the asset picker is skipped; the measurement point pickers are not needed because stations carry them).

Upload is the same single survey call as a spot reading (`mobile-ui-spec.md` section 5):

- `surveyor`, `surveyed_at` (time of Finish), `notes` = "Tracking mode, <direction>, peak <station> <value> dBmV" plus any operator note.
- `points[]`: one entry per mark in walk order, with `sequence_no`, `point_label`, GPS fix at the tap, `pd_magnitude` (mark value), `pd_unit "dBmV"`, `severity` from `classify` (operator can edit), `pd_device`, and `measurement_point_id` for stations P1 to P3.

The API has no field for the mode, so "tracking" is local metadata plus the text in `notes`. If the product wants to filter dashboard history by mode, that is a schema change (needs explicit approval; `planning/schema.sql` is immutable) and is not part of this task.

Marks that were never taken (the operator skipped a station) are simply absent; the API requires at least one point. A walk with no marks cannot be saved.

---

## 6) Tests and acceptance

- Rust unit tests and golden vectors for every rule in section 3 including the exact boundaries; vectors replayed in Node, Worker and WebView like the existing ones.
- Replay the simulated Cantol (`cantol-mock`) with a scripted profile that rises to a peak at P2 and falls: the app must report Rising, Rising, Falling, peak at P2, and the guidance text must change at the thresholds.
- ✅ The same walk gives the same trend words on the phone and in the golden vectors.
- ✅ A saved walk appears in the dashboard history of the three measurement points with the right values and severities; Pole A and B points appear in the survey but not in any point's history.
- ✅ With sound off and reduced motion on, the screen is fully usable.
- ✅ Direction B to A produces the reverse order with correct labels and ids.
- ✅ A lost link mid-walk loses no marks.

## 7) Out of scope

Automatic detection of the strongest point, localisation by triangulation, cable-length estimates and time-of-flight distance. The feature only compares magnitudes along a known span.
