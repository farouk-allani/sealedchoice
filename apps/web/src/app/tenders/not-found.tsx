import Link from "next/link";
import { Icon } from "../../components/ui/icon.tsx";

export default function NotFound() {
  return (
    <div className="directory-empty">
      <Icon name="document" size={34} />
      <h1>Tender not found</h1>
      <p>
        Check the tender number, or browse the directory to find another brief.
      </p>
      <Link
        className="ui-button ui-button--primary ui-button--medium"
        href="/tenders"
      >
        Browse tenders
      </Link>
    </div>
  );
}
