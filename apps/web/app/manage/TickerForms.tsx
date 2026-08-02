"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addTicker, removeTicker } from "./actions";
import type { ActionResult } from "./config";

function SubmitButton({ label, busyLabel, danger }: { label: string; busyLabel: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
        danger
          ? "border-bearish/40 text-bearish hover:bg-bearish/5"
          : "border-line hover:bg-paper"
      }`}
    >
      {pending ? busyLabel : label}
    </button>
  );
}

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p className={`mt-2 text-xs leading-relaxed ${state.ok ? "text-bullish" : "text-bearish"}`}>
      {state.message}
    </p>
  );
}

export function AddTickerForm({ full }: { full: boolean }) {
  const [state, formAction] = useFormState(addTicker, null);

  return (
    <form action={formAction}>
      <div className="flex gap-2">
        <input
          name="symbol"
          placeholder="e.g. NVDA"
          maxLength={10}
          autoComplete="off"
          spellCheck={false}
          disabled={full}
          className="w-40 rounded border border-line bg-white px-3 py-1.5 text-sm uppercase placeholder:normal-case placeholder:text-muted disabled:opacity-50"
        />
        <SubmitButton label="Add ticker" busyLabel="Adding…" />
      </div>
      <Result state={state} />
    </form>
  );
}

export function RemoveTickerForm({ symbol }: { symbol: string }) {
  const [state, formAction] = useFormState(removeTicker, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="symbol" value={symbol} />
      <div className="flex gap-2">
        <input
          name="confirm"
          placeholder={`Type ${symbol}`}
          autoComplete="off"
          spellCheck={false}
          className="w-32 rounded border border-line bg-white px-2 py-1 text-xs uppercase placeholder:normal-case placeholder:text-muted"
        />
        <SubmitButton label="Remove" busyLabel="Removing…" danger />
      </div>
      <Result state={state} />
    </form>
  );
}
