import Link from 'next/link';
import React, { isValidElement } from 'react';
import { GLOSSARY, SIGNAL_LABEL, SIGNAL_MEANING } from '@/lib/ui/explain';

/** Render any cell value: React elements pass through, null/undefined become a dash, everything else is stringified. */
export function cell(v: unknown): React.ReactNode {
    if (v === null || v === undefined) return '—';
    if (isValidElement(v)) return v;
    if (typeof v === 'string' || typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return String(v);
}

export const fmtUsd = (n: unknown, digits = 0) => { const v = Number(n); return Number.isFinite(v) ? (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: digits }) : '—'; };
export const fmtPct = (n: unknown, digits = 1) => { const v = Number(n); return Number.isFinite(v) ? (v * 100).toFixed(digits) + '%' : '—'; };
export const fmtCents = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? Math.round(v * 100) + '¢' : '—'; };
export const fmtNum = (n: unknown, digits = 0) => { const v = Number(n); return Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—'; };
export const fmtTs = (ts: unknown) => { const v = Number(ts); return Number.isFinite(v) && v > 0 ? new Date(v * 1000).toISOString().replace('T', ' ').slice(0, 16) + 'Z' : '—'; };
export const ago = (ts: unknown) => { const v = Number(ts); if (!Number.isFinite(v) || v <= 0) return '—'; const s = Math.max(0, Math.floor(Date.now() / 1000) - v); if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`; };
export const fmtDec = (n: unknown, digits = 1) => { const v = Number(n); if (!Number.isFinite(v)) return '—'; const r = Number(v.toFixed(digits)); return (Object.is(r, -0) ? 0 : r).toFixed(digits); };
export const short = (a: unknown, n = 6) => { const s = String(a ?? ''); return s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s; };

export function Stat({ label, value, sub, tone }: { label: string; value: unknown; sub?: unknown; tone?: 'pos' | 'neg' | 'muted' }) {
    const color = tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-rose-400' : tone === 'muted' ? 'text-zinc-400' : 'text-white';
    return (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
            <div className={`mt-1 font-mono text-xl ${color}`}>{cell(value)}</div>
            {sub !== undefined && sub !== null && <div className="mt-1 text-xs text-zinc-500">{cell(sub)}</div>}
        </div>
    );
}

export function Pill({ children, tone = 'zinc' }: { children: React.ReactNode; tone?: 'zinc' | 'emerald' | 'rose' | 'amber' | 'sky' | 'violet' }) {
    const map = { zinc: 'bg-zinc-800 text-zinc-300', emerald: 'bg-emerald-500/15 text-emerald-300', rose: 'bg-rose-500/15 text-rose-300', amber: 'bg-amber-500/15 text-amber-300', sky: 'bg-sky-500/15 text-sky-300', violet: 'bg-violet-500/15 text-violet-300' };
    return <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[11px] ${map[tone]}`}>{children}</span>;
}

export function Signed({ n, fmt = fmtUsd }: { n: unknown; fmt?: (n: unknown) => string }) {
    const v = Number(n);
    return <span className={v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-zinc-400'}>{v > 0 ? '+' : ''}{fmt(n)}</span>;
}

export function Table({ head, rows, empty = 'No rows yet.' }: { head: React.ReactNode[]; rows: unknown[][]; empty?: string }) {
    return (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-sm">
                <thead className="bg-zinc-900/80 text-[11px] uppercase tracking-wider text-zinc-500">
                    <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                    {rows.length === 0 && <tr><td colSpan={head.length} className="px-3 py-6 text-center text-zinc-500">{empty}</td></tr>}
                    {rows.map((r, i) => <tr key={i} className="hover:bg-zinc-900/50">{r.map((c, j) => <td key={j} className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px] text-zinc-200">{cell(c)}</td>)}</tr>)}
                </tbody>
            </table>
        </div>
    );
}

export function H({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
    return (
        <div className="mb-3 mt-8 flex items-baseline justify-between first:mt-0">
            <h2 className="text-base font-semibold text-white">{children}</h2>
            {sub && <div className="text-xs text-zinc-500">{sub}</div>}
        </div>
    );
}

export function WalletLink({ address, name }: { address: unknown; name?: unknown }) {
    const a = String(address ?? '');
    return <Link href={`/intel/wallets/${a}`} className="text-sky-300 hover:underline" title={a}>{name ? String(name).slice(0, 18) : short(a)}</Link>;
}

export function MarketLink({ conditionId, question, slug }: { conditionId: unknown; question?: unknown; slug?: unknown }) {
    const cid = String(conditionId ?? '');
    const label = String(question || slug || short(cid));
    return <Link href={`/intel/markets/${cid}`} className="text-zinc-100 hover:text-sky-300 hover:underline" title={String(slug ?? '')}>{label.length > 70 ? label.slice(0, 70) + '…' : label}</Link>;
}

export function Empty({ children }: { children: React.ReactNode }) {
    return <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">{children}</div>;
}

export function Filters({ current, options, param, base }: { current: string; options: { value: string; label: string }[]; param: string; base: string }) {
    return (
        <div className="flex flex-wrap gap-1">
            {options.map(o => (
                <Link key={o.value} href={`${base}?${param}=${encodeURIComponent(o.value)}`} className={`rounded px-2 py-1 font-mono text-[12px] ${current === o.value ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}>{o.label}</Link>
            ))}
        </div>
    );
}

/** A technical term with its plain-English definition on hover (and in a title attribute for touch). */
export function Term({ k, children }: { k: string; children?: React.ReactNode }) {
    const def = GLOSSARY[k];
    return <abbr title={def ?? k} className="cursor-help border-b border-dotted border-zinc-600 no-underline">{children ?? k}</abbr>;
}

/** Signal type as a human label with its meaning on hover. */
export function SignalType({ type }: { type: unknown }) {
    const t = String(type ?? '');
    return <abbr title={SIGNAL_MEANING[t] ?? t} className="inline-block cursor-help rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-200 no-underline">{SIGNAL_LABEL[t] ?? t}</abbr>;
}

/** Plain-language help box: what the page is, how to read it, what to do. */
export function Help({ what, read, act }: { what: string; read: string[]; act: string }) {
    return (
        <div className="mb-6 grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-sm md:grid-cols-3">
            <div><div className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">What this is</div><p className="text-zinc-200">{what}</p></div>
            <div><div className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">How to read it</div><ul className="list-disc space-y-1 pl-4 text-zinc-300">{read.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
            <div><div className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">What to do</div><p className="text-zinc-200">{act}</p></div>
        </div>
    );
}

/** A wrapped sentence cell (tables default to nowrap). */
export function Sentence({ children }: { children: React.ReactNode }) {
    return <span className="block max-w-xl whitespace-normal font-sans text-[13px] leading-5 text-zinc-200">{children}</span>;
}
