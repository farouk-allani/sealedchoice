import { Nav } from "../components/landing/nav.tsx";
import { Hero } from "../components/landing/hero.tsx";
import { Story } from "../components/landing/story.tsx";
import { Ranking } from "../components/landing/ranking.tsx";
import { Limits } from "../components/landing/limits.tsx";
import { Verify } from "../components/landing/verify.tsx";
import { Footer } from "../components/landing/footer.tsx";

export default function Home() {
  return (
    <>
      <Nav />
      <main id="top">
        <Hero />
        <Story />
        <Ranking />
        <Limits />
        <Verify />
      </main>
      <Footer />
    </>
  );
}
