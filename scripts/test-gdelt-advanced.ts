import { fetchNegativeSignals, fetchByTheme, fetchGovDocs, detectSignalSpikes, GDELT_THEMES } from '@/lib/intelligence/gdelt-advanced';

async function test() {
    console.log('--- Testing GDELT Advanced ---');

    // 1. Test Theme: Regulation in US
    console.log('\n[1] Fetching REGULATION news in US (.gov)...');
    const regulations = await fetchByTheme(GDELT_THEMES.REGULATION, 'us');
    console.log(`Found ${regulations.length} articles`);
    regulations.slice(0, 3).forEach(r => console.log(` - [${r.tone?.toFixed(1) || 'N/A'}] ${r.title}`));

    // 2. Test Negative Tone: Crypto crisis
    console.log('\n[2] Fetching NEGATIVE crypto news (Global)...');
    const negative = await fetchNegativeSignals(['crypto', 'bitcoin', 'ban'], 'us');
    console.log(`Found ${negative.length} negative articles`);
    negative.slice(0, 3).forEach(r => console.log(` - [${r.tone?.toFixed(1)}] ${r.title}`));

    // 3. Test Gov Docs: Brazil
    console.log('\n[3] Fetching GOV docs from Brazil (.gov.br)...');
    const brazils = await fetchGovDocs('br');
    console.log(`Found ${brazils.length} gov docs`);
    brazils.slice(0, 3).forEach(r => console.log(` - ${r.title} (${r.url})`));
}

test();
