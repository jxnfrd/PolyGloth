'use server';
import { revalidatePath } from 'next/cache';
import { createRule as create, setRuleEnabled, deleteRule as del, ruleFromForm, seedDefaults } from '@/lib/alerts/alerts';

function formToRecord(fd: FormData): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of Array.from(fd.entries())) { const s = String(v); if (k in out) { const cur = out[k]; out[k] = Array.isArray(cur) ? [...cur, s] : [cur, s]; } else out[k] = s; }
    return out;
}

export async function createRule(fd: FormData) {
    const rec = formToRecord(fd);
    const name = Array.isArray(rec.name) ? rec.name[0] : rec.name;
    create(String(name || 'untitled'), ruleFromForm(rec));
    revalidatePath('/intel/alerts');
}
export async function toggleRule(fd: FormData) { const id = Number(fd.get('id')); const enabled = String(fd.get('enabled')) === '1'; setRuleEnabled(id, enabled); revalidatePath('/intel/alerts'); }
export async function deleteRule(fd: FormData) { del(Number(fd.get('id'))); revalidatePath('/intel/alerts'); }
export async function seedRules() { seedDefaults(); revalidatePath('/intel/alerts'); }
