import "./loading.css";

const startupMarkMarkup = typeof document === "undefined"
  ? null
  : document.querySelector<SVGSVGElement>("#root [data-ff-startup-mark]")?.outerHTML ?? null;

export function StartupSplash() {
  return (
    <div className="ff-startup-splash" role="status" aria-label="Loading FactorFlux">
      <div className="ff-startup-splash__content">
        {startupMarkMarkup
          ? <span className="ff-startup-splash__mark-wrap" aria-hidden="true" dangerouslySetInnerHTML={{ __html: startupMarkMarkup }} />
          : <img className="ff-startup-splash__mark" src="/images/ff-login-two-tone.webp" alt="" aria-hidden="true" />}
        <span className="ff-startup-splash__wordmark">FactorFlux</span>
      </div>
    </div>
  );
}

export default StartupSplash;
