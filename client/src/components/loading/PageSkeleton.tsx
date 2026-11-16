import { NeuCard } from "@/styles/neu";
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
      <div className="ff-loading-page__cards" aria-hidden="true">
        {[0, 1, 2].map(item => (
          <NeuCard key={item} className="ff-loading-page__card" style={{ backgroundColor: "hsl(var(--card))" }}>
            <span className="ff-loading-placeholder ff-loading-placeholder--short" />
            <span className="ff-loading-placeholder ff-loading-placeholder--value" />
            <span className="ff-loading-placeholder ff-loading-placeholder--medium" />
          </NeuCard>
        ))}
      </div>
      <NeuCard className="ff-loading-page__panel" style={{ backgroundColor: "hsl(var(--card))" }} aria-hidden="true">
        <span className="ff-loading-placeholder ff-loading-placeholder--title" />
        {[0, 1, 2, 3].map(item => (
          <span key={item} className={`ff-loading-placeholder ${item === 0 ? "ff-loading-placeholder--wide" : "ff-loading-placeholder--full"}`} />
        ))}
      </NeuCard>
    </div>
  );
}

export default PageSkeleton;
