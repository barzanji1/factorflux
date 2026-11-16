import { NeuCard } from "@/styles/neu";
import "./loading.css";

type DashboardOverviewSkeletonProps = {
  part: "metrics" | "charts";
};

const metricLabels = ["Ready to Fund", "In Review", "Open Follow-ups", "Aging 60+", "Funded This Week"];

export function DashboardOverviewSkeleton({ part }: DashboardOverviewSkeletonProps) {
  if (part === "metrics") {
    return (
      <div className="ff-loading-metrics" data-dashboard-overview-loading role="status" aria-label="Loading financial key performance indicators" aria-busy="true">
        <div className="ff-loading-metrics__track" aria-hidden="true">
          {metricLabels.map(label => (
            <NeuCard key={label} className="ff-neu-kpi-card ff-loading-metric-card">
              <div className="ff-loading-metric-card__top">
                <span className="ff-loading-placeholder ff-loading-placeholder--medium" />
                <span className="ff-loading-placeholder ff-loading-metric-card__icon" />
              </div>
              <div className="ff-loading-metric-card__bottom">
                <span className="ff-loading-placeholder ff-loading-placeholder--value" />
                <span className="ff-loading-placeholder ff-loading-placeholder--short" />
              </div>
            </NeuCard>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="ff-loading-charts" aria-label="Loading financial overview" role="status" aria-busy="true" data-testid="financial-overview-loading">
      <div className="ff-loading-charts__heading">
        <p className="ff-neu-eyebrow">Capital in motion</p>
        <h2 id="financial-overview-heading" className="ff-neu-section-title">Financial Overview</h2>
      </div>
      <div className="ff-loading-charts__grid" aria-hidden="true">
        <NeuCard pressed className="ff-neu-chart-card ff-loading-chart-card">
          <div className="ff-loading-chart-card__header">
            <div className="ff-loading-chart-card__titles">
              <span className="ff-loading-placeholder ff-loading-placeholder--medium" />
              <span className="ff-loading-placeholder ff-loading-placeholder--wide" />
            </div>
            <span className="ff-loading-placeholder ff-loading-chart-card__mark" />
          </div>
          <div className="ff-loading-chart-plot">
            {[38, 65, 49, 78, 57, 86, 66].map((height, index) => <span key={index} className="ff-loading-chart-plot__bar" style={{ height: `${height}%` }} />)}
          </div>
        </NeuCard>
        <NeuCard pressed className="ff-neu-chart-card ff-loading-chart-card">
          <div className="ff-loading-chart-card__header">
            <div className="ff-loading-chart-card__titles">
              <span className="ff-loading-placeholder ff-loading-placeholder--medium" />
              <span className="ff-loading-placeholder ff-loading-placeholder--wide" />
            </div>
            <span className="ff-loading-placeholder ff-loading-chart-card__mark" />
          </div>
          <div className="ff-loading-chart-plot">
            <span className="ff-loading-chart-plot__line ff-loading-chart-plot__line--one" />
            <span className="ff-loading-chart-plot__line ff-loading-chart-plot__line--two" />
          </div>
        </NeuCard>
      </div>
    </section>
  );
}

export default DashboardOverviewSkeleton;
