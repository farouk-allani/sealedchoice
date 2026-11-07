"use client";

import Link from "next/link";
import { Button } from "../../components/ui/button.tsx";
import { Icon } from "../../components/ui/icon.tsx";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="directory-empty">
      <Icon name="document" size={34} />
      <h1>This page could not be loaded</h1>
      <p>Try loading it again to read the latest tender information.</p>
      <div className="form-actions">
        <Link
          className="ui-button ui-button--secondary ui-button--medium"
          href="/tenders"
        >
          Back to tenders
        </Link>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
