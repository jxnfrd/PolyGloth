'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

export async function deleteSignal(signalId: string) {
    const supabase = await createClient();

    try {
        const { error } = await supabase
            .from('contrarian_signals')
            .delete()
            .eq('id', signalId);

        if (error) {
            console.error('Error deleting signal:', error);
            return { success: false, error: error.message };
        }

        revalidatePath('/admin');
        revalidatePath('/dashboard');
        return { success: true };
    } catch (error) {
        console.error('Server action error:', error);
        return { success: false, error: 'Internal Server Error' };
    }
}
