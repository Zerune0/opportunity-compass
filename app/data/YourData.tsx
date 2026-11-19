"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import {
  MAX_BACKUP_BYTES,
  applyBackup,
  backupFileName,
  buildBackup,
  collectBackupData,
  parseBackup,
  summarizeBackup,
  type BackupFile,
  type BackupSummary,
} from "@/lib/backup";
import { clearAll } from "@/lib/store";

/** Local calendar date as YYYY-MM-DD. */
function localToday(): string {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

type Row = { key: keyof BackupSummary; label: string; sample?: boolean };

/** One row per kind of stored data. Rows marked sample hold local demo data only. */
const ROWS: Row[] = [
  { key: "evidence", label: "Evidence items in the profile" },
  { key: "saved_opportunities", label: "Saved opportunities" },
  { key: "journal_entries", label: "Quest Journal entries" },
  { key: "materials", label: "Application materials" },
  { key: "plan_snapshots", label: "Saved route plans (replay history)" },
  { key: "user_posted_opportunities", label: "Opportunities posted in this browser", sample: true },
  { key: "share_settings", label: "Sharing settings" },
  { key: "invitations", label: "Invitations", sample: true },
  { key: "grants", label: "Organizer grants", sample: true },
];

function profileLabel(summary: BackupSummary): string {
  if (!summary.has_profile) return "None";
  return summary.profile_name ? `Yes: ${summary.profile_name}` : "Yes";
}

function SampleTag() {
  return <StatusTag tone="warning">Sample</StatusTag>;
}

type Pending = { fileName: string; backup: BackupFile; warnings: string[] };

export function YourData() {
  const [current, setCurrent] = useState<BackupSummary>();
  const [exportMessage, setExportMessage] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [exportTooLarge, setExportTooLarge] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Clear the file picker so choosing the same file again fires a change event. */
  function resetFileInput() {
    if (fileInput.current) fileInput.current.value = "";
  }

  // Browser-only: re-read localStorage after every write so the page shows what is stored.
  const refresh = useCallback(() => {
    setCurrent(summarizeBackup({ data: collectBackupData() }));
  }, []);

  useEffect(() => {
    const initialRead = window.setTimeout(refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.clearTimeout(initialRead);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [refresh]);

  function exportData() {
    try {
      const today = localToday();
      const backup = buildBackup(collectBackupData(), today);
      const text = JSON.stringify(backup, null, 2);
      setExportTooLarge(new Blob([text]).size > MAX_BACKUP_BYTES);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = backupFileName(today);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage(`Download started: ${backupFileName(today)}.`);
    } catch {
      setExportTooLarge(false);
      setExportMessage("Could not create the backup file in this browser.");
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setPending(null);
    if (!file) {
      setImportMessage("");
      return;
    }
    if (file.size > MAX_BACKUP_BYTES) {
      input.value = "";
      setImportMessage("This file is larger than 2 MB, so it is not an Opportunity Compass backup. Nothing was changed.");
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportMessage("Could not read this file. Nothing was changed.");
      return;
    } finally {
      // The file has been read (or failed); clear the picker so the same file can be chosen again.
      input.value = "";
    }
    const result = parseBackup(text);
    if (!result.ok) {
      setImportMessage(`${result.error} Nothing was changed.`);
      return;
    }
    setPending({ fileName: file.name, backup: result.backup, warnings: result.warnings });
    setImportMessage("File checked. Review what it contains below. Nothing has been changed yet.");
  }

  function replaceData() {
    if (!pending) return;
    if (!window.confirm("Replace everything stored in this browser with the contents of this file? Data that is not in the file will be removed.")) return;
    const result = applyBackup(pending.backup);
    refresh();
    resetFileInput();
    if (!result.ok) {
      setImportMessage(result.error);
      return;
    }
    setPending(null);
    setImportMessage(`Imported ${pending.fileName}. Your data in this browser now matches the file.`);
  }

  function deleteAll() {
    if (!window.confirm("Delete all your Opportunity Compass data in this browser? This cannot be undone. Export a backup first if you might want it later.")) return;
    clearAll();
    setPending(null);
    refresh();
    setDeleteMessage("All Opportunity Compass data in this browser was deleted.");
  }

  const incoming = pending ? summarizeBackup(pending.backup) : null;

  return (
    <div className="rpg-stack rpg-stack--loose">
      <header className="rpg-head crt">
        <h1>Your data</h1>
        <p>
          This app has no accounts and no server. Everything you enter is stored in this browser only. Export a
          file to keep a backup or move to another browser.
        </p>
        <p className="rpg-small rpg-muted">
          Clearing your browser data or switching browsers removes it. The file is a backup you keep yourself, not a sync.
        </p>
      </header>

      <QuestCard aria-labelledby="stored-title">
        <h2 id="stored-title">What is stored</h2>
        {current === undefined ? (
          <p className="rpg-muted">Reading this browser&apos;s storage…</p>
        ) : (
          <ul className="rpg-list">
            <li>
              Profile: {profileLabel(current)} {current.profile_is_sample && <SampleTag />}
            </li>
            {ROWS.map((row) => (
              <li key={row.key}>
                {row.label}: {current[row.key] as number} {row.sample && <SampleTag />}
              </li>
            ))}
          </ul>
        )}
        <p className="rpg-small rpg-muted">Items marked Sample are local demo data, not real people or real results.</p>
      </QuestCard>

      <QuestCard aria-labelledby="export-title">
        <h2 id="export-title">Export</h2>
        <p>
          This file contains everything you entered, including your profile and date of birth if you added it. Keep
          it private.
        </p>
        <RpgButton onClick={exportData}>Download my data (.json)</RpgButton>
        <p role="status" className="rpg-small">{exportMessage}</p>
        <p role="status" className="rpg-small">
          {exportTooLarge ? "This file is larger than the 2 MB import limit, so it cannot be imported back here." : ""}
        </p>
      </QuestCard>

      <QuestCard aria-labelledby="import-title">
        <h2 id="import-title">Import</h2>
        <p>Choose a backup file you exported earlier. It is read in this browser only and is not uploaded anywhere.</p>
        <label className="rpg-field">
          Backup file (.json)
          <input ref={fileInput} type="file" accept="application/json,.json" onChange={chooseFile} />
        </label>
        <p role="status" className="rpg-small">{importMessage}</p>
        {pending && incoming && (
          <div className="rpg-stack">
            <p>
              <strong>Importing replaces everything currently stored in this browser.</strong>
            </p>
            <table className="rpg-classic-table">
              <caption>
                {pending.fileName}
                {pending.backup.exported_on ? ` (exported ${pending.backup.exported_on})` : ""}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">In this browser now</th>
                  <th scope="col">In the file</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Profile</th>
                  <td data-label="In this browser now">
                    {current ? profileLabel(current) : "Unknown"} {current?.profile_is_sample && <SampleTag />}
                  </td>
                  <td data-label="In the file">
                    {profileLabel(incoming)} {incoming.profile_is_sample && <SampleTag />}
                  </td>
                </tr>
                {ROWS.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">
                      {row.label} {row.sample && <SampleTag />}
                    </th>
                    <td data-label="In this browser now">{current ? (current[row.key] as number) : "Unknown"}</td>
                    <td data-label="In the file">{incoming[row.key] as number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pending.warnings.length > 0 && (
              <div className="rpg-stack">
                <h3>Problems found in the file</h3>
                <p className="rpg-small">
                  Skipped items will not be imported; changed items are imported as described. Everything else in the
                  file is fine.
                </p>
                <ul className="rpg-list">
                  {pending.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rpg-row">
              <RpgButton variant="secondary" onClick={replaceData}>Replace my data with this file</RpgButton>
              <RpgButton
                variant="secondary"
                onClick={() => {
                  setPending(null);
                  resetFileInput();
                  setImportMessage("Import cancelled. Nothing was changed.");
                }}
              >
                Cancel
              </RpgButton>
            </div>
          </div>
        )}
      </QuestCard>

      <QuestCard aria-labelledby="delete-title">
        <h2 id="delete-title">Delete everything</h2>
        <p>
          Removes your profile, evidence, journal, materials, saved opportunities and all other Opportunity Compass data
          from this browser. <StatusTag tone="danger">Cannot be undone</StatusTag>
        </p>
        <RpgButton variant="secondary" onClick={deleteAll}>Delete all my data in this browser</RpgButton>
        <p role="status" className="rpg-small">{deleteMessage}</p>
      </QuestCard>
    </div>
  );
}
