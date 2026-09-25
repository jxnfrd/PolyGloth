import { alertsPage } from '@/lib/ui/queries-report';
import { SIGNAL_TYPES } from '@/lib/alerts/alerts';
import { ALL_CATEGORIES } from '@/lib/pm/categories';
import { Table, H, Pill, MarketLink, WalletLink, ago, Empty } from '@/components/intel/ui';
import { createRule, toggleRule, deleteRule, seedRules } from './actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const input = 'rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[12px] text-white';

export default function Alerts({ searchParams }: { searchParams: { rule?: string } }) {
    const ruleId = searchParams.rule ? Number(searchParams.rule) : undefined;
    const { rules, alerts } = alertsPage(ruleId);
    return (
        <div>
            <H sub="rules are JSON, evaluated by scripts/pm-alerts.ts evaluate; Telegram delivery when TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set">Alert rules</H>
            {rules.length === 0 && <form action={seedRules}><Empty>No rules yet. <button className="ml-2 rounded bg-zinc-100 px-2 py-1 font-mono text-[12px] text-zinc-900">create the 4 default rules</button></Empty></form>}
            <Table head={['', 'id', 'name', 'rule', 'alerts', '']}
                rows={rules.map(r => [
                    <form key="t" action={toggleRule}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="enabled" value={r.enabled ? '0' : '1'} /><button className={`rounded px-2 py-0.5 font-mono text-[11px] ${r.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-400'}`}>{r.enabled ? 'on' : 'off'}</button></form>,
                    r.id, <a key="n" href={`/intel/alerts?rule=${r.id}`} className="text-sky-300 hover:underline">{r.name}</a>, <span key="j" className="text-zinc-400">{JSON.stringify(r.rule)}</span>,
                    alerts.filter(a => a.rule_id === r.id).length,
                    <form key="d" action={deleteRule}><input type="hidden" name="id" value={r.id} /><button className="text-rose-400 hover:underline">delete</button></form>
                ])} />
            <H>New rule</H>
            <form action={createRule} className="grid grid-cols-1 gap-3 rounded-lg border border-zinc-800 p-4 md:grid-cols-3">
                <label className="text-xs text-zinc-400">name<br /><input name="name" required className={`${input} w-full`} placeholder="e.g. smart consensus + comment spike" /></label>
                <label className="text-xs text-zinc-400">min score<br /><input name="minScore" type="number" step="any" className={`${input} w-full`} /></label>
                <label className="text-xs text-zinc-400">min wallets (consensus/shill)<br /><input name="minWallets" type="number" className={`${input} w-full`} /></label>
                <div className="text-xs text-zinc-400 md:col-span-3">signal types<div className="mt-1 flex flex-wrap gap-2">{SIGNAL_TYPES.map(t => <label key={t} className="flex items-center gap-1 font-mono text-[11px] text-zinc-300"><input type="checkbox" name="signalTypes" value={t} />{t}</label>)}</div></div>
                <div className="text-xs text-zinc-400 md:col-span-3">categories<div className="mt-1 flex flex-wrap gap-2">{ALL_CATEGORIES.map(c => <label key={c} className="flex items-center gap-1 font-mono text-[11px] text-zinc-300"><input type="checkbox" name="categories" value={c} />{c}</label>)}<label className="flex items-center gap-1 font-mono text-[11px] text-zinc-300"><input type="checkbox" name="excludeSports" />exclude sports</label></div></div>
                <label className="text-xs text-zinc-400">price min (0..1)<br /><input name="priceMin" type="number" step="0.01" min="0" max="1" className={`${input} w-full`} /></label>
                <label className="text-xs text-zinc-400">price max (0..1)<br /><input name="priceMax" type="number" step="0.01" min="0" max="1" className={`${input} w-full`} /></label>
                <label className="text-xs text-zinc-400">min usdc (payload)<br /><input name="minUsdc" type="number" className={`${input} w-full`} /></label>
                <label className="text-xs text-zinc-400">wallet min calibrated ROI<br /><input name="walletMinCalibratedRoi" type="number" step="0.01" className={`${input} w-full`} /></label>
                <label className="text-xs text-zinc-400">wallet max p-value<br /><input name="walletMaxPValue" type="number" step="0.01" className={`${input} w-full`} /></label>
                <label className="text-xs text-zinc-400">wallet min resolved<br /><input name="walletMinResolved" type="number" className={`${input} w-full`} /></label>
                <label className="text-xs text-zinc-400">min arb edge (0.01 = 1%)<br /><input name="minEdge" type="number" step="0.001" className={`${input} w-full`} /></label>
                <label className="text-xs text-zinc-400">min early-resolution gap (¢)<br /><input name="minGapCents" type="number" className={`${input} w-full`} /></label>
                <div className="grid grid-cols-2 gap-2"><label className="text-xs text-zinc-400">also require type<br /><select name="requireType" className={`${input} w-full`}><option value="">—</option>{SIGNAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></label><label className="text-xs text-zinc-400">within minutes<br /><input name="requireWithinMinutes" type="number" defaultValue={60} className={`${input} w-full`} /></label></div>
                <div className="md:col-span-3"><button className="rounded bg-zinc-100 px-3 py-1 font-mono text-[12px] text-zinc-900">create rule</button></div>
            </form>
            <H sub={ruleId ? `rule ${ruleId}` : 'all rules'}>Latest alerts</H>
            <Table head={['when', 'rule', 'market', 'wallet', 'summary', 'delivered']}
                rows={alerts.map(a => [ago(a.ts), String(a.rule_name), a.condition_id ? <MarketLink key="m" conditionId={a.condition_id} question={a.question} /> : '—', a.wallet ? <WalletLink key="w" address={a.wallet} /> : '—', <span key="s" className="text-zinc-300">{a.summary}</span>, a.delivered ? <Pill key="d" tone="emerald">sent</Pill> : <Pill key="p" tone="amber">pending</Pill>])}
                empty="No alerts yet. Run: npx tsx scripts/pm-alerts.ts evaluate 168" />
        </div>
    );
}
