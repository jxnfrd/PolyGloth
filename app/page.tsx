import Hero from '@/components/landing/Hero';
import ProblemSection from '@/components/landing/ProblemSection';
import SolutionGrid from '@/components/landing/SolutionGrid';
import InteractivePreview from '@/components/landing/InteractivePreview';
import FooterCTA from '@/components/landing/FooterCTA';

export default function Home() {
  return (
    <main className="bg-gray-950 min-h-screen">
      <Hero />
      <ProblemSection />
      <SolutionGrid />
      <InteractivePreview />
      <FooterCTA />
    </main>
  );
}
