// Maintenance Mode Override
export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black text-white">
      <h1 className="text-4xl font-bold">System Maintenance 🛠️</h1>
      <p className="mt-4 text-gray-400">Upgrading Intelligence Engine... (V2 Check)</p>
    </div>
  );
}

/* 
import CryptoPricing from '@/components/ui/Pricing/CryptoPricing';
import { createClient } from '@/utils/supabase/server';
import {
  getProducts,
  getSubscription,
  getUser
} from '@/utils/supabase/queries';

export default async function PricingPage() {
  const supabase = await createClient();
  const [user, products, subscription] = await Promise.all([
    getUser(supabase),
    getProducts(supabase),
    getSubscription(supabase)
  ]);

  return (
    <CryptoPricing
      user={user}
    />
  );
}
*/
