import { useLayoutEffect } from "react";
import { useLocation } from "wouter";

export function CustomerBrandHead() {
  const [location] = useLocation();
  useLayoutEffect(() => {
    const customerPage = /^\/portal(?:\/|$)/.test(location);
    document.title = customerPage ? "Trucking Pros Financial — Carrier Portal" : "FactorFlux - Trucking Pros Financial";
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = customerPage ? "/images/tpf-logo.png" : "/images/ff-logo-emboss.png";
  }, [location]);
  return null;
}
