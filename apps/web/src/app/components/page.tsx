import type { Metadata } from "next";
import { ComponentReview } from "../../components/review/component-review.tsx";
import { previewFontVariables } from "./preview-fonts.ts";
import "../../components/ui/ui.css";
import "./review.css";

export const metadata: Metadata = {
  title: "Component review",
  description: "An interactive review of the SealedChoice app components.",
  robots: { index: false, follow: false },
};

export default function ComponentsPage() {
  return (
    <div className={previewFontVariables}>
      <ComponentReview />
    </div>
  );
}
