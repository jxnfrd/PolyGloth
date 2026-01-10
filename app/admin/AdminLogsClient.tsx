'use client';

import { useState } from 'react';

interface LogEntry {
    id: number;
    created_at: string;
    log_level: 'info' | 'warning' | 'error';
    component: string;
    message: string;
}

export default function AdminLogsClient({ initialLogs }: { initialLogs: LogEntry[] }) {
    const [filter, setFilter] = useState<'ALL' | 'INFO' | 'WARNING' | 'ERROR'>('ALL');

    const filteredLogs = initialLogs.filter(log => {
        if (filter === 'ALL') return true;
        return log.log_level.toUpperCase() === filter;
    });

    return (
        <div>
            {/* Filter Tabs */}
            <div className="flex gap-2 mb-4 px-4 sm:px-6">
                {(['ALL', 'INFO', 'WARNING', 'ERROR'] as const).map((f) => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filter === f
                                ? 'bg-indigo-600 text-white'
                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                    >
                        {f}
                    </button>
                ))}
            </div>

            {/* Table */}
            <table className="min-w-full divide-y divide-gray-800">
                <thead className="bg-gray-800">
                    <tr>
                        <th scope="col" className="py-2 pl-4 pr-3 text-left text-xs font-semibold text-gray-400 sm:pl-6">Level</th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Component</th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Message</th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Time</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                    {filteredLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-800/50">
                            <td className="whitespace-nowrap py-2 pl-4 pr-3 text-xs sm:pl-6">
                                <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${log.log_level === 'error' ? 'bg-red-400/10 text-red-400 ring-red-400/20' :
                                        log.log_level === 'warning' ? 'bg-yellow-400/10 text-yellow-400 ring-yellow-400/20' :
                                            'bg-green-400/10 text-green-400 ring-green-400/20'
                                    }`}>
                                    {log.log_level.toUpperCase()}
                                </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-300">{log.component}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-300 max-w-lg truncate" title={log.message}>
                                {log.message}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                                {new Date(log.created_at).toLocaleTimeString()}
                            </td>
                        </tr>
                    ))}
                    {filteredLogs.length === 0 && (
                        <tr><td colSpan={4} className="p-4 text-center text-gray-500">No logs found matching filter.</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
