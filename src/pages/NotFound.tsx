import { Link } from "react-router-dom";
import { EmptyState, PageHeader } from "../components/ui";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <div className="panel">
        <EmptyState
          title="This page doesn't exist"
          description="The link may be outdated or you may not have access to it."
          action={
            <Link className="btn btn-primary" to="/">
              Go to dashboard
            </Link>
          }
        />
      </div>
    </>
  );
}
