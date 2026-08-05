/** Shared across every route (App.tsx) and the standalone export bundle (export-main.tsx). */
export function Footer() {
  return (
    <footer className="app-footer">
      <span>Retrace</span>
      <span className="app-footer-sep" aria-hidden="true">
        ·
      </span>
      <a href="https://github.com/Vlad-Mirzoian/retrace" target="_blank" rel="noreferrer">
        GitHub
      </a>
      <span className="app-footer-sep" aria-hidden="true">
        ·
      </span>
      <a href="https://github.com/Vlad-Mirzoian/retrace/blob/main/docs/ci.md" target="_blank" rel="noreferrer">
        CI setup
      </a>
    </footer>
  );
}
