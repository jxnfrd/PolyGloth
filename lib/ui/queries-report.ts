import { listRules, listAlerts } from '@/lib/alerts/alerts';
import { entries, scoreTags, attribution, portfolio } from '@/lib/report/journal';
import { latest, build } from '@/lib/report/edge-report';

/** Read-side for /intel/alerts, /intel/journal, /intel/report. All local SQLite, no network. */
export function alertsPage(ruleId?: number) { return { rules: listRules(), alerts: listAlerts(100, ruleId) }; }
export function journalPage() { return { entries: entries(200), tags: scoreTags(), attribution: attribution(0), portfolio: portfolio() }; }
export function reportPage() { return latest() ?? build(); }
