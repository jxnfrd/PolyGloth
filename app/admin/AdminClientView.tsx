'use client';

import { useState } from 'react';
import AdminSignalsTable from './AdminSignalsTable';
import AdminLogsClient from './AdminLogsClient';
import AdminMarketsTable from './AdminMarketsTable';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function AdminClientView({ signals, logs }: { signals: any[], logs: any[] }) {
    const [activeTab, setActiveTab] = useState<'signals' | 'markets' | 'logs'>('signals');

    return (
        <div>
            {/* Tabs Navigation */}
            <div className="border-b border-gray-700 mb-6">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    <button
                        onClick={() => setActiveTab('signals')}
                        className={`${activeTab === 'signals'
                                ? 'border-indigo-500 text-indigo-400'
                                : 'border-transparent text-gray-400 hover:border-gray-300 hover:text-gray-300'
                            } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
                    >
                        Signals (Processed)
                    </button>
                    <button
                        onClick={() => setActiveTab('markets')}
                        className={`${activeTab === 'markets'
                                ? 'border-indigo-500 text-indigo-400'
                                : 'border-transparent text-gray-400 hover:border-gray-300 hover:text-gray-300'
                            } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
                    >
                        Markets (Raw Feed)
                    </button>
                    <button
                        onClick={() => setActiveTab('logs')}
                        className={`${activeTab === 'logs'
                                ? 'border-indigo-500 text-indigo-400'
                                : 'border-transparent text-gray-400 hover:border-gray-300 hover:text-gray-300'
                            } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium`}
                    >
                        System Logs
                    </button>
                </nav>
            </div>

            {/* Tab Content */}
            <div className="min-h-[400px]">
                {activeTab === 'signals' && (
                    <AdminSignalsTable initialSignals={signals} />
                )}

                {activeTab === 'markets' && (
                    <AdminMarketsTable />
                )}

                {activeTab === 'logs' && (
                    <AdminLogsClient initialLogs={logs} />
                )}
            </div>
        </div>
    );
}
