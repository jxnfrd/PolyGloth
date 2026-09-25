import { ReactNode } from 'react';
import IntelNav from '@/components/intel/IntelNav';

export default function IntelLayout({ children }: { children: ReactNode }) {
    return (
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <IntelNav />
            {children}
        </div>
    );
}
