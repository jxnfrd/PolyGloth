import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function seed() {
    console.log('Seeding Contrarian Signals...');

    const signals = [
        {
            market_title: 'Will 2025 be the hottest year on record?',
            market_id: 'seed-001',
            article_url: 'https://sample-news.com/la-nina-cooling-2025',
            article_language: 'pt',
            key_finding: 'INPE (Brazil Space Agency) data suggests strong La Niña persistence throughout 2025, predicting global temperatures 0.2°C below 2024 averages.',
            evidence_type: 'scientific_data',
            contradiction_score: 88,
            confidence: 'High'
        },
        {
            market_title: 'Bitcoin to break $100k by Q2 2025?',
            market_id: 'seed-002',
            article_url: 'https://estadao.com.br/economy/crypto-regulation-brazil',
            article_language: 'pt',
            key_finding: 'New draft bill in Brazil proposes strict capital controls on crypto exchanges effectively freezing USD outflows, a major liquidity bottleneck ignored by western markets.',
            evidence_type: 'regulatory_risk',
            contradiction_score: 75,
            confidence: 'Medium'
        },
        {
            market_title: 'Will the Fed cut rates in March?',
            market_id: 'seed-003',
            article_url: 'https://elpais.com/economia/inflation-spain-rise',
            article_language: 'es',
            key_finding: 'Spanish unexpected inflation spike (4.1%) is driving ECB hawkishness, which historically correlates with Fed hesitation on synchronized rate cuts.',
            evidence_type: 'macro_correlation',
            contradiction_score: 65,
            confidence: 'Medium'
        }
    ];

    const { error } = await supabase.from('contrarian_signals').insert(signals);

    if (error) {
        console.error('Error seeding signals:', error);
    } else {
        console.log('Successfully seeded 3 signals!');
    }
}

seed();
