/**
 * Category assignment from Gamma event tags + slug heuristics.
 * Used for category-level track records (a trader can be sharp on Fed markets and terrible on NBA).
 */
export type Category = 'politics' | 'sports' | 'crypto' | 'economy' | 'science_tech' | 'culture' | 'geopolitics' | 'business' | 'other';

const TAG_RULES: [RegExp, Category][] = [
    [/\b(nfl|nba|mlb|nhl|ncaa|soccer|football|basketball|tennis|golf|ufc|mma|boxing|esports|cs2|dota|valorant|league of legends|cricket|f1|formula|hockey|baseball|premier league|la liga|bundesliga|serie a|champions league|wnba|mls|olympics|sports)\b/i, 'sports'],
    [/\b(crypto|bitcoin|btc|ethereum|eth|solana|sol|memecoin|token|defi|nft|stablecoin|altcoin|xrp|doge)\b/i, 'crypto'],
    [/\b(fed|fomc|interest rate|inflation|cpi|jobs|unemployment|gdp|recession|treasury|tariff|economy|economic|macro|rates)\b/i, 'economy'],
    [/\b(election|president|senate|house|congress|governor|primary|nomination|democrat|republican|trump|biden|harris|parliament|prime minister|vote|poll|politics|cabinet|supreme court|impeach)\b/i, 'politics'],
    [/\b(war|ceasefire|invasion|ukraine|russia|israel|gaza|iran|china|taiwan|nato|geopolit|sanction|strait|missile|nuclear|military)\b/i, 'geopolitics'],
    [/\b(ai|openai|gpt|space|spacex|nasa|science|tech|apple|google|tesla|launch|model release|climate|weather|temperature|hurricane|earthquake)\b/i, 'science_tech'],
    [/\b(earnings|stock|ipo|merger|acquisition|ceo|company|business|market cap|s&p|nasdaq|revenue)\b/i, 'business'],
    [/\b(movie|film|oscar|grammy|music|album|celebrity|tv|show|netflix|box office|culture|pop|taylor swift|award|eurovision|reality)\b/i, 'culture']
];

const SLUG_SPORTS = /^(atp|wta|nfl|nba|mlb|nhl|epl|ucl|cs2|lol|dota2?|val|mma|ufc|ncaa|cfb|cbb|wnba|mls|bra\d?|col\d?|conl|unl|el\d|gtm|hkt|sau|uae|qat|kbo|npb|liga|bundesliga|serie|ligue|nrl|afl|ipl|f1)-/i;
const SLUG_CRYPTO = /(btc|eth|sol|xrp|doge|bitcoin|ethereum|solana|crypto)-/i;

export function categorize(tags: string[], slug = '', title = ''): Category {
    if (SLUG_SPORTS.test(slug)) return 'sports';
    if (/updown|up-or-down/i.test(slug)) return 'crypto';
    const hay = [...tags, title].join(' | ');
    for (const [re, cat] of TAG_RULES) if (re.test(hay)) return cat;
    if (SLUG_CRYPTO.test(slug)) return 'crypto';
    return 'other';
}

export const ALL_CATEGORIES: Category[] = ['politics', 'sports', 'crypto', 'economy', 'science_tech', 'culture', 'geopolitics', 'business', 'other'];
