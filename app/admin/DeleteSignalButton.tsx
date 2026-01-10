'use client';

import { TrashIcon } from '@heroicons/react/24/outline';
import { deleteSignal } from '@/app/actions/delete-signal';
import { useState } from 'react';

export default function DeleteSignalButton({ signalId }: { signalId: string }) {
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this signal?')) return;

        setIsDeleting(true);
        const result = await deleteSignal(signalId);

        if (!result.success) {
            alert('Failed to delete signal');
            setIsDeleting(false);
        }
    };

    return (
        <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
            title="Delete Signal"
        >
            {isDeleting ? '...' : <TrashIcon className="h-5 w-5" />}
        </button>
    );
}
