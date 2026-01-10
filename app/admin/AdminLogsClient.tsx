'use client';

import { useState } from 'react';

interface LogEntry {
    id: number;
    created_at: string;
    log_level: 'info' | 'warning' | 'error';
    component: string;
    message: string;
    metadata?: any; // Added metadata for the new log display
}

export default function AdminLogsClient({ initialLogs }: { initialLogs: LogEntry[] }) {
    const [filter, setFilter] = useState<'ALL' | 'INFO' | 'WARNING' | 'ERROR'>('ALL');
    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 25;
    const [logs, setLogs] = useState<LogEntry[]>(initialLogs);

    // Reset page when new logs arrive or initialLogs changes
    useEffect(() => {
        setLogs(initialLogs);
        setPage(1);
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
                                < td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                        {new Date(log.created_at).toLocaleTimeString()}
                    </td>
                        </tr>
                    ))}
            {filteredLogs.length === 0 && (
                <tr><td colSpan={4} className="p-4 text-center text-gray-500">No logs found matching filter.</td></tr>
            )}
        </tbody>
            </table >
        </div >
    );
}
