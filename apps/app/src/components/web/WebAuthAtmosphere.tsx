import { useEffect, useRef } from "react";

import "./WebAuthAtmosphere.css";

export default function WebAuthAtmosphere() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncVisibility = () => {
      rootRef.current?.classList.toggle("is-paused", document.hidden);
    };

    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  return (
    <div ref={rootRef} className="web-auth-atmosphere" aria-hidden="true">
      <span className="web-auth-atmosphere__spectrum" />
      <span className="web-auth-atmosphere__mesh" />
      <span className="web-auth-atmosphere__plane is-primary" />
      <span className="web-auth-atmosphere__plane is-secondary" />
      <span className="web-auth-atmosphere__plane is-emphasis" />
      <span className="web-auth-atmosphere__halo is-mint" />
      <span className="web-auth-atmosphere__halo is-secondary" />
      <span className="web-auth-atmosphere__ribbon is-upper" />
      <span className="web-auth-atmosphere__ribbon is-lower" />
      <span className="web-auth-atmosphere__orbit is-wide" />
      <span className="web-auth-atmosphere__orbit is-close" />
      <span className="web-auth-atmosphere__signal is-one" />
      <span className="web-auth-atmosphere__signal is-two" />
    </div>
  );
}
