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
                        <div key={signal.id} className="overflow-hidden rounded-xl bg-gray-900 ring-1 ring-white/10">
                            <div className="p-6">
                                <div className="flex items-center justify-between gap-x-4">
                                    <div className="text-sm leading-6 text-gray-400">{new Date(signal.created_at).toLocaleDateString()}</div>
                                    <div className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${signal.confidence === 'High' ? 'bg-green-400/10 text-green-400 ring-green-400/20' :
                                        signal.confidence === 'Medium' ? 'bg-yellow-400/10 text-yellow-400 ring-yellow-400/20' :
                                            'bg-red-400/10 text-red-400 ring-red-400/20'
                                        }`}>
                                        {signal.confidence} Confidence
                                    </div>
                                </div>
                                <h3 className="mt-4 text-lg font-semibold leading-6 text-white">{signal.market_title}</h3>
                                <p className="mt-4 text-sm leading-6 text-gray-300">{signal.key_finding}</p>
                                <div className="mt-6 border-t border-gray-800 pt-6">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-400">Contradiction Score:</span>
                                        <span className="font-semibold text-white">{signal.contradiction_score}/100</span>
                                    </div>
                                    <div className="mt-2 text-xs text-gray-500 truncate">
                                        Src: <a href={signal.article_url} target="_blank" className="hover:text-indigo-400">{signal.article_url}</a>
                                    </div>
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
