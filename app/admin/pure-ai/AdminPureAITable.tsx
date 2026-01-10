'use client';

import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function AdminPureAITable({ predictions }: { predictions: any[] }) {
    if (!predictions || predictions.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500">
                No Pure AI predictions generated yet. Run the scan script!
            </div>
        );
    }

    return (
        <div className="overflow-hidden bg-gray-900 shadow ring-1 ring-white/10 sm:rounded-lg">
            <table className="min-w-full divide-y divide-gray-800">
                <thead className="bg-gray-800">
                    <tr>
                        <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-white sm:pl-6">Market</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Prediction</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Confidence</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Model</th>
                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">Time</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                    {predictions.map((pred) => (
                        <tr key={pred.id} className="hover:bg-gray-800/50">
                            <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-white sm:pl-6 max-w-xs truncate" title={pred.market_question}>
                                <a
                                    href={`https://polymarket.com/event/${pred.market_slug}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-purple-400 transition-colors flex items-center gap-2"
                                >
                                    {pred.market_question ? pred.market_question.substring(0, 40) + '...' : 'Unknown Market'}
                                    <ArrowTopRightOnSquareIcon className="h-4 w-4 text-gray-500" />
                                </a>
                            </td>
                            <td className="px-3 py-4 text-sm text-gray-300">
                                <span className="font-bold text-white">{pred.estimated_probability}% Yes</span>
                                <p className="text-xs text-gray-500 mt-1 line-clamp-1 italic">"{pred.prediction_summary}"</p>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm">
                                <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${pred.confidence_level === 'high' ? 'bg-green-400/10 text-green-400 ring-green-400/20' :
                                        pred.confidence_level === 'medium' ? 'bg-yellow-400/10 text-yellow-400 ring-yellow-400/20' :
                                            'bg-red-400/10 text-red-400 ring-red-400/20'
                                    }`}>
                                    {(pred.confidence_level || 'medium').toUpperCase()}
                                </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-xs text-gray-500">
                                {pred.ai_model_used}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-xs text-gray-500">
                                {new Date(pred.analysis_timestamp).toLocaleString()}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
