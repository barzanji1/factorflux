import { useState } from "react";
import { LiquidGlassPanel } from "@factorflux/liquid-glass";
import "./_group.css";

export function Material() {
  const [sceneReplay, setSceneReplay] = useState(true);
  const [ripples, setRipples] = useState(true);

  return (
    <main className="lg-study">
      <div className="lg-study__calibration" aria-hidden="true" />
      <div className="lg-study__stage">
        <LiquidGlassPanel
          className="lg-study__panel"
          scene={
            sceneReplay
              ? {
                  src: "/__mockup/images/tpf-building.jpg",
                  position: "center 46%",
                  size: "cover",
                  filter: "brightness(0.35) saturate(0.76) contrast(1.05)",
                  overlay: "linear-gradient(135deg, rgba(19, 45, 63, 0.24), rgba(25, 51, 72, 0.48))",
                }
              : undefined
          }
          enableRipples={ripples}
        >
          <div className="lg-study__content">
            <div className="lg-study__eyebrow">FactorFlux · Optical material study</div>
            <h1 className="lg-study__title">A surface,<br />not a blur.</h1>
            <p className="lg-study__description">
              Clear center, shaped edge. The scene bends only as it crosses the rounded lens.
            </p>

            <div className="lg-study__instrument" aria-label="Optical calibration grid">
              <p className="lg-study__instrument-label">Lens profile / perimeter</p>
              <p className="lg-study__instrument-value">R 34 · Δ 26px</p>
            </div>

            <dl className="lg-study__readings">
              <div className="lg-study__reading">
                <dt>Surface</dt>
                <dd>Silver-blue / clear field</dd>
              </div>
              <div className="lg-study__reading">
                <dt>Response</dt>
                <dd>{ripples ? "Pointer wavelets" : "Still water"}</dd>
              </div>
            </dl>

            <div className="lg-study__controls">
              <button
                type="button"
                className="lg-study__control"
                aria-pressed={sceneReplay}
                onClick={() => setSceneReplay((value) => !value)}
              >
                Scene replay · {sceneReplay ? "on" : "off"}
              </button>
              <button
                type="button"
                className="lg-study__control"
                aria-pressed={ripples}
                onClick={() => setRipples((value) => !value)}
              >
                Pointer ripples · {ripples ? "on" : "off"}
              </button>
            </div>
            <p className="lg-study__footnote">Move through the glass; the calibration remains crisp.</p>
          </div>
        </LiquidGlassPanel>
      </div>
    </main>
  );
}

export default Material;
