-- Seed data for Contrarian Signals
INSERT INTO contrarian_signals (
    market_title,
    market_id,
    article_url,
    article_language,
    key_finding,
    evidence_type,
    contradiction_score,
    confidence
) VALUES 
(
    'Will 2025 be the hottest year on record?',
    'seed-001',
    'https://sample-news.com/la-nina-cooling-2025',
    'pt',
    'INPE (Brazil Space Agency) data suggests strong La Niña persistence throughout 2025, predicting global temperatures 0.2°C below 2024 averages.',
    'scientific_data',
    88,
    'High'
),
(
    'Bitcoin to break $100k by Q2 2025?',
    'seed-002',
    'https://estadao.com.br/economy/crypto-regulation-brazil',
    'pt',
    'New draft bill in Brazil proposes strict capital controls on crypto exchanges effectively freezing USD outflows, a major liquidity bottleneck ignored by western markets.',
    'regulatory_risk',
    75,
    'Medium'
),
(
    'Will the Fed cut rates in March?',
    'seed-003',
    'https://elpais.com/economia/inflation-spain-rise',
    'es',
    'Spanish unexpected inflation spike (4.1%) is driving ECB hawkishness, which historically correlates with Fed hesitation on synchronized rate cuts.',
    'macro_correlation',
    65,
    'Medium'
);
