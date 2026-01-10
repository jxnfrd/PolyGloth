import axios from 'axios';

// GDELT 2.0 Doc API
const GDELT_API_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

export interface NewsArticle {
    url: string;
    title: string;
    language: string;
    source: string;
    date: string;
    contentSnippet?: string;
}

// Map to GDELT 3-letter codes
const LANG_MAP: Record<string, string> = {
    'es': 'spa',
    'pt': 'por',
    'zh': 'zho',
    'de': 'deu',
    'en': 'eng',
    'fr': 'fra'
};

export async function queryNonEnglishNews(keywords: string[], languages: string[] = ['es', 'pt', 'zh', 'de']): Promise<NewsArticle[]> {
    try {
        const mappedLanguages = languages.map(l => LANG_MAP[l] || l);
        const langQuery = mappedLanguages.map(lang => `sourcelang:${lang}`).join(' OR ');
        const keywordQuery = keywords.map(k => `"${k}"`).join(' OR ');

        // GDELT requires very specific syntax. Parentheses only if OR is involved.
        let fullQuery = '';

        if (languages.length > 1) {
            fullQuery += `(${langQuery}) `;
        } else {
            fullQuery += `${langQuery} `;
        }

        if (keywords.length > 1) {
            fullQuery += `(${keywordQuery})`;
        } else {
            fullQuery += `${keywordQuery}`;
        }

        console.log('GDELT Query:', fullQuery);

        const response = await axios.get(GDELT_API_URL, {
            params: {
                query: fullQuery,
                mode: 'artlist',
                format: 'json',
                maxrecords: 20,
                timespan: '48h',
                sort: 'DateDesc'
            }
        });

        if (response.data && response.data.articles) {
            return response.data.articles.map((article: Record<string, string>) => ({
                url: article.url,
                title: article.title,
                language: article.language || 'unknown',
                source: article.domain,
                date: article.seendate,
                contentSnippet: article.seendate
            }));
        } else {
            console.log('GDELT No articles found. Response data:', JSON.stringify(response.data)?.substring(0, 200));
        }

        return [];
    } catch (error) {
        console.error('Error fetching GDELT news:', error);
        return [];
    }
}
