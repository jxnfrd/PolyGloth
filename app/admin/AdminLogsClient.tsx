'use client';

import { useState, useEffect } from 'react';

interface LogEntry {
    id: number;
    created_at: string;
    log_level: 'info' | 'warning' | 'error';
    component: string;
    message: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any;
}

export default function AdminLogsClient({ initialLogs }: { initialLogs: LogEntry[] }) {
    const [filter, setFilter] = useState<'ALL' | 'INFO' | 'WARNING' | 'ERROR'>('ALL');
    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 25;
    const [logs, setLogs] = useState<LogEntry[]>(initialLogs || []);

    // Reset page when new logs arrive or initialLogs changes
    useEffect(() => {
        if (initialLogs) {
            setLogs(initialLogs);
            setPage(1);
        }
    }, [initialLogs]);

    const filteredLogs = logs.filter(log => {
        if (filter === 'ALL') return true;
        return log.log_level.toUpperCase() === filter;
    });

    const totalPages = Math.ceil(filteredLogs.length / ITEMS_PER_PAGE);
    const paginatedLogs = filteredLogs.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    return (
        <div>
            {/* Filter Tabs */}
            <div className="flex gap-2 mb-4 px-4 sm:px-6">
                {(['ALL', 'INFO', 'WARNING', 'ERROR'] as const).map((level) => (
                    <button
                        key={level}
                        onClick={() => { setFilter(level); setPage(1); }}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === level
                                ? 'bg-indigo-500 text-white'
                                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                    >
                        {level}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
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
                        {paginatedLogs.map((log) => (
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
                                <td className="px-3 py-2 text-xs text-gray-300 max-w-lg break-words">
                                    {log.message}
                                    {log.metadata && (
                                        <details className="mt-1">
                                            <summary className="cursor-pointer text-gray-500 hover:text-gray-400">View Details</summary>
                                            <pre className="mt-1 text-[10px] bg-black/30 p-2 rounded overflow-x-auto text-gray-400">
                                                {JSON.stringify(log.metadata, null, 2)}
                                            </pre>
                                        </details>
                                    )}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                                    {new Date(log.created_at).toLocaleTimeString()}
                                </td>
                            </tr>
                        ))}
                        {paginatedLogs.length === 0 && (
                            <tr><td colSpan={4} className="p-4 text-center text-gray-500">No logs found matching filter.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4 px-4 border-t border-gray-800 pt-4">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-gray-300 transition-colors"
                    >
                        &larr; Previous
                    </button>
                    <span className="text-xs text-gray-500">
                        Page {page} of {totalPages}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-gray-300 transition-colors"
                    >
                        Next &rarr;
                    </button>
                </div>
            )}
        </div>
    );
}
