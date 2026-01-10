export interface NormalizedFinancialData {
    source: string;
    type: 'STOCK' | 'FOREX' | 'ECONOMIC' | 'TREASURY' | 'CRYPTO';
    asset?: string;
    value?: number | string;
    unit?: string;
    date?: string;
    description?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw?: any;
}

export interface CompanyFundamentals {
    source: 'ALETHEIA';
    symbol: string;
    companyName: string;
    sector: string;
    latestPrice: number;
    marketCap: number;
    keyStats: {
        peRatio: number;
        dividendYield: number;
        profitMargin: number;
    };
    nextEarningsDate: string;
}

export interface EconomicIndicator {
    source: 'FRED' | 'WORLDBANK';
    seriesId: string;
    title: string;
    latestValue: number;
    previousValue?: number;
    date: string;
    unit: string;
    country?: string;
}

export interface ForexRate {
    source: 'ALPHAVANTAGE' | 'FISCALDATA';
    from: string;
    to: string;
    rate: number;
    date: string;
}

export interface StandardizedContext {
    fundamentals?: CompanyFundamentals[];
    economics?: EconomicIndicator[];
    forex?: ForexRate[];
    newsSentiment?: string[];
}
