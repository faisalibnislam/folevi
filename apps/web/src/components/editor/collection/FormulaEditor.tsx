"use client";

// A formula property's editor: the formula with suggestions as you type (property names and functions), a
// live preview on the view's first rows, the number format, and (when Foli AI is on) "Write a formula" from
// words through the table formula action (convex/tableAi.ts, AI credits). Results are worked out here, on
// the device; the server checks and keeps only the formula's text.
import { useAction } from "convex/react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import {
  TABLE_CURRENCIES,
  collectionFormulaProblem,
  collectionFormulaSyntaxError,
  collectionFormulaTable,
  evaluateCollectionFormulas,
  type CollectionFormulaResult,
  type CollectionNumberFormat,
} from "@folevi/editor-schema";
import { api } from "@/lib/convex/api";
import { useAppState } from "@/lib/app/state";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { AiIcon } from "@/components/ai/AiIcon";
import { useAiEnabled } from "@/components/ai/useAi";
import { AiCreditsNote, AiProblemNotice, aiProblem, type AiProblem } from "@/components/ai/AiCredits";
import { formatCalendarDate } from "@/i18n";
import { applySuggestion, formulaFromAi, formulaSuggestions, type Suggestions } from "./formulaAssist";

export interface FormulaEditorProperty {
  id: string;
  name: string;
  type: string;
  options: { id: string; name: string; color: string }[];
  formula?: string | null;
  numberFormat?: CollectionNumberFormat | null;
}

export interface FormulaEditorRow {
  id: string;
  title: string;
  values: Record<string, unknown>;
}

const PREVIEW_ROWS = 5;

/** A formula's result as the collection shows it (a date in the person's language, an error with its reason). */
export function FormulaValue({ result }: { result: CollectionFormulaResult | undefined }) {
  if (!result || result.kind === "empty") return <span className="text-faint">-</span>;
  if (result.kind === "error") {
    return (
      <span className="cursor-help font-medium text-danger underline decoration-dotted underline-offset-2" title={result.error?.message} aria-label={`${result.display}: ${result.error?.message ?? ""}`} data-formula-error={result.display}>
        {result.display}
      </span>
    );
  }
  if (result.kind === "boolean") {
    return (
      <span role="img" aria-label={result.value ? "True" : "False"} className={`inline-grid h-4 w-4 place-items-center rounded-tiny border text-[10px] leading-none ${result.value ? "border-heading bg-heading text-canvas" : "border-line-strong"}`}>
        {result.value ? "✓" : ""}
      </span>
    );
  }
  if (result.kind === "date") return <time dateTime={String(result.value)}>{formatCalendarDate(String(result.value))}</time>;
  return <span className={result.kind === "number" ? "tabular-nums" : undefined}>{result.display}</span>;
}

/** Number format choices: plain, number, currency, percent; decimals; the currency. */
export function NumberFormatFields({ value, onChange, compact }: { value: CollectionNumberFormat | null | undefined; onChange: (next: CollectionNumberFormat | null) => void; compact?: boolean }) {
  const cls = compact ? "h-7 ui-input rounded-chip px-2 text-xs" : "h-8 ui-input rounded-chip px-3 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        aria-label="Number format"
        value={value?.format ?? ""}
        onChange={(e) => {
          const format = e.target.value as CollectionNumberFormat["format"] | "";
          onChange(format ? { ...(value ?? {}), format, ...(format === "currency" ? { currency: value?.currency ?? "USD" } : { currency: undefined }) } : null);
        }}
        className={cls}
      >
        <option value="">Plain</option>
        <option value="number">Number (1,234.5)</option>
        <option value="currency">Currency</option>
        <option value="percent">Percent</option>
      </Select>
      {value?.format === "currency" ? (
        <Select aria-label="Currency" value={value.currency ?? "USD"} onChange={(e) => onChange({ ...value, currency: e.target.value })} className={cls}>
          {TABLE_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      ) : null}
      {value ? (
        <Select
          aria-label="Decimal places"
          value={value.decimals === undefined ? "" : String(value.decimals)}
          onChange={(e) => onChange({ ...value, decimals: e.target.value === "" ? undefined : Number(e.target.value) })}
          className={cls}
        >
          <option value="">Auto decimals</option>
          {[0, 1, 2, 3, 4].map((d) => (
            <option key={d} value={String(d)}>
              {d === 1 ? "1 decimal" : `${d} decimals`}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}

const sameFormat = (a: CollectionNumberFormat | null | undefined, b: CollectionNumberFormat | null | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function FormulaEditor({
  open,
  onClose,
  property,
  properties,
  rows,
  people,
  hostDocumentId,
  typeLabel,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  property: FormulaEditorProperty;
  properties: readonly FormulaEditorProperty[];
  /** The view's rows, in order (the preview shows the first few). */
  rows: readonly FormulaEditorRow[];
  people: readonly { id: string; name: string }[];
  hostDocumentId: string;
  typeLabel: (type: string) => string;
  onSave: (change: { formula?: string; numberFormat?: CollectionNumberFormat | null }) => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={`Formula for “${property.name}”`} description={'Use other properties by name, like Price * Qty or prop("Unit price"). Functions work as in Sheets: IF, ROUND, CONCAT, DAYS, TODAY and more.'} size="lg">
      {open ? <FormulaForm property={property} properties={properties} rows={rows} people={people} hostDocumentId={hostDocumentId} typeLabel={typeLabel} onSave={onSave} onClose={onClose} /> : null}
    </Dialog>
  );
}

function FormulaForm({
  property,
  properties,
  rows,
  people,
  hostDocumentId,
  typeLabel,
  onSave,
  onClose,
}: {
  property: FormulaEditorProperty;
  properties: readonly FormulaEditorProperty[];
  rows: readonly FormulaEditorRow[];
  people: readonly { id: string; name: string }[];
  hostDocumentId: string;
  typeLabel: (type: string) => string;
  onSave: (change: { formula?: string; numberFormat?: CollectionNumberFormat | null }) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(property.formula ?? "");
  const [format, setFormat] = useState<CollectionNumberFormat | null>(property.numberFormat ?? null);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // Where the caret goes once a suggestion is in (set right after the render, before the next key).
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = pendingCaret.current;
    if (at === null || !area.current) return;
    pendingCaret.current = null;
    area.current.focus();
    area.current.setSelectionRange(at, at);
  });
  const listId = useId();
  const errorId = useId();

  const others = useMemo(() => properties.filter((p) => p.id !== property.id), [properties, property.id]);
  const suggestions: Suggestions | null = useMemo(() => (caret === null || hidden ? null : formulaSuggestions(draft, caret, others, typeLabel)), [draft, caret, hidden, others, typeLabel]);
  useEffect(() => setActive(0), [suggestions?.from, suggestions?.items.length]);

  // The properties with this one's draft formula and format, for the checks and the preview.
  const drafted = useMemo(() => properties.map((p) => (p.id === property.id ? { ...p, type: "formula", formula: draft, numberFormat: format } : p)), [properties, property.id, draft, format]);
  const problem = useMemo(() => collectionFormulaProblem(drafted, property.id, draft.trim()) ?? collectionFormulaSyntaxError(draft, drafted), [drafted, property.id, draft]);
  const preview = useMemo(() => {
    const names = new Map(people.map((p) => [p.id, p.name]));
    const first = rows.slice(0, PREVIEW_ROWS);
    const results = evaluateCollectionFormulas(drafted, first, { personName: (id) => names.get(id) ?? "Someone" });
    return first.map((r, i) => ({ row: r, result: results[i]?.[property.id] }));
  }, [drafted, rows, people, property.id]);

  const put = (s: Suggestions, i: number) => {
    const item = s.items[i];
    if (!item) return;
    const next = applySuggestion(draft, s, item);
    pendingCaret.current = next.caret;
    setDraft(next.text);
    setCaret(next.caret);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions && suggestions.items.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % suggestions.items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + suggestions.items.length) % suggestions.items.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        put(suggestions, active);
        return;
      }
      if (e.key === "Escape") {
        // Closes the suggestions, not the dialog.
        e.preventDefault();
        e.stopPropagation();
        setHidden(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void save();
    }
  };

  const changed = draft.trim() !== (property.formula ?? "").trim() || !sameFormat(format, property.numberFormat);
  const save = async () => {
    if (problem || saving) return;
    if (!changed) return onClose();
    setSaving(true);
    try {
      await onSave({
        ...(draft.trim() !== (property.formula ?? "").trim() ? { formula: draft.trim() } : {}),
        ...(!sameFormat(format, property.numberFormat) ? { numberFormat: format } : {}),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const syncCaret = () => setCaret(area.current?.selectionStart ?? null);
  const activeId = suggestions?.items[active] ? `${listId}-${active}` : undefined;

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={`${listId}-input`} className="mb-1 block text-sm font-semibold">
          Formula
        </label>
        <textarea
          id={`${listId}-input`}
          ref={area}
          role="combobox"
          aria-expanded={Boolean(suggestions?.items.length)}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-invalid={Boolean(problem)}
          aria-describedby={problem ? errorId : undefined}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={3}
          maxLength={1000}
          value={draft}
          placeholder={'Price * Qty, IF(Done, "Yes", "No"), DAYS(Due, TODAY())'}
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionStart);
            setHidden(false);
          }}
          onKeyDown={onKey}
          onKeyUp={(e) => {
            if (e.key.startsWith("Arrow") && !suggestions) syncCaret();
          }}
          onClick={syncCaret}
          onBlur={() => setTimeout(() => setHidden(true), 120)}
          onFocus={() => setHidden(false)}
          className="block w-full resize-y ui-input rounded-chip px-3 py-2 font-mono text-[13px] leading-5"
        />
        {suggestions?.items.length ? (
          <ul id={listId} role="listbox" aria-label="Suggestions" className="mt-1 max-h-56 overflow-y-auto ui-pop rounded-chip p-1">
            {suggestions.items.map((s, i) => (
              <li
                key={`${s.kind}:${s.label}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                data-highlighted={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => put(suggestions, i)}
                className="ui-menu-item flex cursor-pointer items-baseline gap-2 rounded-tiny px-2 py-1.5 text-sm pointer-coarse:min-h-11 pointer-coarse:items-center"
              >
                <span className={s.kind === "function" ? "font-mono text-[12.5px]" : "font-medium"}>{s.label}</span>
                <span className="truncate text-xs text-faint">{s.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {problem ? (
          <p id={errorId} role="alert" className="mt-1.5 text-[13px] text-danger">
            {problem}
          </p>
        ) : null}
      </div>

      <WriteWithAi property={property} properties={properties} rows={rows} people={people} hostDocumentId={hostDocumentId} onFormula={(f) => setDraft(f)} />

      <section aria-label="Preview">
        <h3 className="ui-caps mb-1.5">Preview</h3>
        {preview.length ? (
          <table className="w-full border-collapse text-sm">
            <tbody>
              {preview.map(({ row, result }) => (
                <tr key={row.id}>
                  <th scope="row" className="w-1/2 border-b border-line py-1.5 pr-3 text-left font-normal text-muted">
                    <span className="line-clamp-1">{row.title || "Untitled"}</span>
                  </th>
                  <td className="border-b border-line py-1.5">
                    <FormulaValue result={result} />
                    {result?.kind === "error" && result.error ? <span className="ml-2 text-xs text-muted">{result.error.message}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">Add a row to see what the formula gives.</p>
        )}
      </section>

      <section aria-label="Number format">
        <h3 className="ui-caps mb-1.5">Numbers show as</h3>
        <NumberFormatFields value={format} onChange={setFormat} />
      </section>

      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={Boolean(problem) || saving} onClick={() => void save()}>
          Save formula
        </Button>
      </div>
    </div>
  );
}

/** "Write a formula" from words (Foli AI; hidden when it's off). */
function WriteWithAi({
  property,
  properties,
  rows,
  people,
  hostDocumentId,
  onFormula,
}: {
  property: FormulaEditorProperty;
  properties: readonly FormulaEditorProperty[];
  rows: readonly FormulaEditorRow[];
  people: readonly { id: string; name: string }[];
  hostDocumentId: string;
  onFormula: (formula: string) => void;
}) {
  const aiOn = useAiEnabled();
  const { scope } = useAppState();
  const formulaAction = useAction(api.tableAi.formula);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AiProblem | null>(null);
  const [explanation, setExplanation] = useState("");
  if (!aiOn) return null;

  const run = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    setExplanation("");
    try {
      // The collection as a table Foli AI can write a formula for: the other properties (a table has at
      // most 20 columns), this one empty, and the first rows as examples. Its cell is on the first row.
      const others = properties.filter((p) => p.id !== property.id).slice(0, 18);
      const picked = [...others, { ...property, type: "formula", formula: null }];
      const names = new Map(people.map((p) => [p.id, p.name]));
      const table = collectionFormulaTable(picked, rows.slice(0, 30).length ? rows.slice(0, 30) : [{ title: "", values: {} }], { personName: (id) => names.get(id) ?? "Someone" });
      const column = picked.length - 1;
      const reply = await formulaAction({
        scope,
        documentId: hostDocumentId,
        table: { rows: table.rows, headerRow: true },
        row: 1,
        column,
        instruction: `${text.trim()}\n(This is a database: the formula is the same for every row. Name the row's columns, never cells like B2.)`,
      });
      onFormula(formulaFromAi(reply.formula, table.rows[0]!, 2));
      setExplanation(reply.explanation);
    } catch (e) {
      setError(aiProblem(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Write a formula with Foli AI" className="rounded-chip ui-well p-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <AiIcon size={15} className="flex-none text-[#7c6cf0]" />
        <input
          aria-label="Describe the formula"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a formula: price times quantity, days until due..."
          maxLength={500}
          className="h-9 min-w-0 flex-1 ui-input rounded-chip px-3 text-sm"
        />
        <Button size="sm" type="submit" disabled={busy || !text.trim()} aria-label="Write the formula">
          {busy ? "Writing..." : <ArrowUp size={14} aria-hidden />}
        </Button>
      </form>
      {explanation ? (
        <p className="mt-2 text-[13px] text-muted" role="status">
          {explanation}
        </p>
      ) : null}
      {error ? <AiProblemNotice problem={error} className="mt-2" /> : null}
      <AiCreditsNote documentId={hostDocumentId} className="mt-2" />
    </section>
  );
}
