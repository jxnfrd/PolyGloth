import { createClient } from '@/utils/supabase/server';

export default async function Dashboard() {
    const supabase = await createClient(); // createClient is async in some starter kits
    const { data: signals } = await supabase.from('contrarian_signals').select('*').order('created_at', { ascending: false });

    return (
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-white">PolyGlot Intelligence Dashboard</h1>
            <p className="mt-2 text-sm text-gray-400">Latest contrarian signals detected by our engine.</p>

            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {signals && signals.length > 0 ? (
                    signals.map((signal: any) => (
                        <div key={signal.id} className="overflow-hidden rounded-xl bg-gray-900 ring-1 ring-white/10 hover:ring-indigo-500/50 transition-all duration-300">
                            <div className="p-6">
                                <div className="flex items-center justify-between gap-x-4 mb-4">
                                    <div className="flex items-center gap-2">
                                        <div className={`h-3 w-3 rounded-full ${signal.indicator_color === 'green' ? 'bg-green-500 animate-pulse' :
                                                signal.indicator_color === 'orange' ? 'bg-orange-500' :
                                                    'bg-red-500'
                                            }`} title={`Freshness Score: ${signal.freshness_score || 'N/A'}`} />

                                        <div className={`rounded-md px-2 py-1 text-xs font-bold ring-1 ring-inset ${signal.tier === 1 ? 'bg-indigo-400/10 text-indigo-400 ring-indigo-400/20' :
                                            signal.tier === 2 ? 'bg-blue-400/10 text-blue-400 ring-blue-400/20' :
                                                'bg-gray-400/10 text-gray-400 ring-gray-400/20'
                                            }`}>
                                            TIER {signal.tier || '3'}
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        {signal.time_advantage_hours > 0 && (
                                            <div className="rounded-md bg-green-400/10 px-2 py-1 text-xs font-medium text-green-400 ring-1 ring-inset ring-green-400/20">
                                                {signal.time_advantage_hours}h Adv
                                            </div>
                                        )}
                                        <div className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${signal.confidence === 'High' ? 'bg-green-400/10 text-green-400 ring-green-400/20' :
                                            signal.confidence === 'Medium' ? 'bg-yellow-400/10 text-yellow-400 ring-yellow-400/20' :
                                                'bg-red-400/10 text-red-400 ring-red-400/20'
                                            }`}>
                                            {signal.confidence}
                                        </div>
                                    </div>
                                </div>

                                <h3 className="text-lg font-semibold leading-6 text-white min-h-[3rem] line-clamp-2">
                                    <a href={`/api/track/click?signal_id=${signal.id}&slug=${signal.market_slug}`} target="_blank" className="hover:text-indigo-400 transition-colors">
                                        {signal.market_title}
                                    </a>
                                </h3>

                                <p className="mt-4 text-sm leading-6 text-gray-300 line-clamp-3 italic">
                                    "{signal.key_finding}"
                                </p>

                                <div className="mt-4 flex flex-wrap gap-2">
                                    <span className="inline-flex items-center rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-300">
                                        {signal.evidence_type?.replace('_', ' ') || 'Analysis'}
                                    </span>
                                    <span className="inline-flex items-center rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-300">
                                        Score: {signal.contradiction_score}/100
                                    </span>
                                    {signal.freshness_score > 0 && (
                                        <span className="inline-flex items-center rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-300">
                                            Freshness: {signal.freshness_score}
                                        </span>
                                    )}
                                </div>

                                <div className="mt-6 border-t border-gray-800 pt-6 flex justify-between items-center">
                                    <div className="text-xs text-gray-500 max-w-[50%] truncate">
                                        Src: <a href={signal.article_url} target="_blank" className="hover:text-indigo-400 underline decoration-gray-700 underline-offset-2">
                                            {new URL(signal.article_url).hostname.replace('www.', '')}
                                        </a>
                                        <span className="ml-1 text-gray-600">· {new Date(signal.news_published_at || signal.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>

                                    <a
                                        href={`/api/track/click?signal_id=${signal.id}&slug=${signal.market_slug}`}
                                        target="_blank"
                                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                                    >
                                        View Market &rarr;
                                    </a>
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="col-span-full text-center text-gray-500 py-10">
                        No signals found. Run the scan script to populate data!
                    </div>
                )}
            </div>
        </div>
    );
}
