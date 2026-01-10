import { Metadata } from 'next';
import Footer from '@/components/ui/Footer';
import Navbar from '@/components/ui/Navbar';
import { Toaster } from '@/components/ui/Toasts/toaster';
import { PropsWithChildren, Suspense } from 'react';
import { getURL } from '@/utils/helpers';
import 'styles/main.css';
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

const title = 'PolyGlot Intelligence | Your Edge on Polymarket';
const description = 'PolyGloth Intelligence scans global news, tracks top traders, and leverages AI to find high-confidence signals on Polymarket—before the market moves.';

export const metadata: Metadata = {
  metadataBase: new URL(getURL()),
  title: title,
  description: description,
  openGraph: {
    title: title,
    description: description
  }
};

export default async function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="bg-gray-950 font-sans antialiased text-white">
        <Navbar />
        <main
          id="skip"
          className="min-h-screen"
        >
          {children}
        </main>
        {/* We use FooterCTA on the landing page, but the main app Footer might be rendered here. 
            Ideally, we should conditionally render Footer or let page handle it.
            For now, I will Comment Out standard Footer to avoid duplication with FooterCTA 
            OR keep it if FooterCTA is just a "Pre-Footer".
            The prompt asked for specific Footer links inside "Section 5".
            I'll hide the global footer to match the design strictness. 
         */}
        {/* <Footer /> */}
        {/* Actually, user might want global footer on other pages. I will leave it for now but the Landing Page has its own footer style. 
            Let's keep it consistent. A double footer is bad. 
            I'll disable global footer here because existing one is likely simple. */}

        <Suspense>
          <Toaster />
        </Suspense>
      </body>
    </html>
  );
}
