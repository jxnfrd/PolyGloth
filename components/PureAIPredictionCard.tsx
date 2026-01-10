import React from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function PureAIPredictionCard({ prediction }: { prediction: any }) {
    const isHigh = prediction.confidence === 'high';
    const isMedium = prediction.confidence === 'medium';

    return (
        <div className="overflow-hidden rounded-xl bg-gray-900 ring-1 ring-white/10 hover:ring-purple-500/50 transition-all duration-300">
            <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between gap-x-4 mb-4">
                    <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-purple-400/10 px-2 py-1 text-xs font-medium text-purple-400 ring-1 ring-inset ring-purple-400/20">
                            ✨ PURE AI ESTIMATION
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${isHigh ? 'bg-green-400/10 text-green-400 ring-green-400/20' :
                                isMedium ? 'bg-yellow-400/10 text-yellow-400 ring-yellow-400/20' :
                                    'bg-red-400/10 text-red-400 ring-red-400/20'
                            }`}>
                            {prediction.confidence?.toUpperCase() || 'MEDIUM'} CONFIDENCE
                        </span>
                    </div>
                </div>

                {/* Question */}
                <h3 className="text-lg font-semibold leading-6 text-white min-h-[3rem] line-clamp-2 mb-3">
                    <a href={`https://polymarket.com/event/${prediction.market_slug}`} target="_blank" className="hover:text-purple-400 transition-colors">
                        {prediction.market_question}
                    </a>
                </h3>

                {/* Prediction Summary */}
                <div className="bg-gray-800/50 rounded-lg p-3 mb-4">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">AI Forecast</span>
                        <span className="text-lg font-bold text-white">{prediction.estimated_probability}% <span className="text-gray-400 text-xs font-medium">YES</span></span>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed italic">
                        "{prediction.prediction_summary}"
                    </p>
                </div>

                {/* Expandable Reasoning */}
                <details className="group">
                    <summary className="flex cursor-pointer items-center text-xs font-semibold text-gray-500 hover:text-indigo-400 select-none">
                        <svg className="mr-2 h-4 w-4 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                        View Full Reasoning Chain
                    </summary>
                    <div className="mt-3 text-xs leading-5 text-gray-400 border-t border-gray-800 pt-3">
                        {prediction.reasoning}
                    </div>
                </details>

                {/* Footer */}
                <div className="mt-4 flex items-center justify-between text-xs text-gray-600">
                    <span>Model: {prediction.ai_model_used}</span>
                    <span>{new Date(prediction.analysis_timestamp).toLocaleDateString()}</span>
                </div>
            </div>
        </div>
    );
}
