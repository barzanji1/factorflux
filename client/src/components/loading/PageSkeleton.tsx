import { FirstVisitSkeleton } from "./PageSnapshotFrame";
import "./loading.css";

export type PageSkeletonProps = {
  title?: string;
  status?: boolean;
};

export function PageSkeleton({ title, status = true }: PageSkeletonProps) {
  const label = title ? `Loading ${title}` : "Loading page";
  return (
    <div className="ff-loading-page" {...(status ? { role: "status", "aria-label": label, "data-route-loading": "" } : { "aria-hidden": true })} aria-busy="true">
      <div className="ff-loading-page__heading" aria-hidden="true">
        {title && <span className="ff-loading-navigation-pending__label">{title}</span>}
        <span className="ff-loading-placeholder ff-loading-placeholder--title" />
        <span className="ff-loading-placeholder ff-loading-placeholder--medium" />
      </div>
      <FirstVisitSkeleton dashboard={title === "Agent Dashboard"} />
    </div>
  );
}

export default PageSkeleton;
