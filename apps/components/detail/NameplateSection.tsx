import type { Asset } from "@/lib/types";

const FIELDS: [keyof Asset, string, string?][] = [
  ["manufacturer", "Manufacturer"],
  ["serial_number", "Serial No."],
  ["manufacture_year", "Year"],
  ["phase_configuration", "Phase"],
  ["rated_capacity_kva", "Capacity", "kVA"],
  ["rated_primary_voltage_kv", "Rated primary", "kV"],
  ["rated_secondary_voltage_v", "Rated secondary", "V"],
  ["rated_frequency_hz", "Frequency", "Hz"],
  ["impedance_percent", "Impedance", "%"],
  ["cooling_type", "Cooling"],
];

export function NameplateSection({ asset }: { asset: Asset }) {
  const present = FIELDS.filter(([key]) => asset[key] != null);
  if (present.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No nameplate details recorded yet.</p>;
  }

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
      {present.map(([key, label, unit]) => (
        <div key={key} className="contents">
          <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
          <dd className="text-slate-800 dark:text-slate-100">
            {String(asset[key])}
            {unit ? ` ${unit}` : ""}
          </dd>
        </div>
      ))}
    </dl>
  );
}
