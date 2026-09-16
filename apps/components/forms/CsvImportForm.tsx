"use client";

import { useState } from "react";
import Papa from "papaparse";
import { apiFetch } from "@/lib/api";

export type ParsedRow<T> = { data: T } | { error: string };

export function CsvImportForm<T>({
  endpoint,
  templateHeader,
  parseRow,
  onSuccess,
  onCancel,
}: {
  endpoint: string;
  templateHeader: string[];
  parseRow: (row: Record<string, string>) => ParsedRow<T>;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<T[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setSubmitError(null);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const validRows: T[] = [];
        const errors: string[] = [];
        results.data.forEach((raw, i) => {
          const outcome = parseRow(raw);
          if ("error" in outcome) errors.push(`Row ${i + 2}: ${outcome.error}`); // +2: header row + 1-index
          else validRows.push(outcome.data);
        });
        setRows(validRows);
        setParseErrors(errors);
      },
    });
  }

  async function handleImport() {
    setSubmitting(true);
    setSubmitError(null);

    const res = await apiFetch(endpoint, {
      method: "POST",
      body: JSON.stringify({ rows }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      const rowMessages = payload?.errors?.rows as string[] | undefined;
      setSubmitError(rowMessages?.join(" ") ?? payload?.message ?? "Import failed.");
      return;
    }
    onSuccess();
  }

  return (
    <div className="space-y-3">
      <label className="block cursor-pointer rounded border border-dashed border-slate-300 p-4 text-center hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{fileName ?? "Choose a CSV file"}</span>
        <p className="mt-1 text-xs text-slate-400">Header row: {templateHeader.join(", ")}</p>
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
      </label>

      {parseErrors.length > 0 && (
        <div className="max-h-32 space-y-0.5 overflow-y-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {parseErrors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {rows.length > 0 && <p className="text-sm text-slate-600 dark:text-slate-300">{rows.length} row(s) ready to import.</p>}
      {submitError && <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleImport}
          disabled={rows.length === 0 || submitting}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
        >
          {submitting ? "Importing…" : `Import ${rows.length || ""} row(s)`.trim()}
        </button>
      </div>
    </div>
  );
}
