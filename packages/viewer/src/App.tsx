import { Link, Route, Routes } from "react-router-dom";
import { ComparePage } from "./pages/ComparePage.js";
import { SessionDetailPage } from "./pages/SessionDetailPage.js";
import { SessionListPage } from "./pages/SessionListPage.js";

export function App() {
  return (
    <>
      <header className="app-header">
        <Link to="/">
          <strong>Retrace</strong>
        </Link>
      </header>
      <Routes>
        <Route path="/" element={<SessionListPage />} />
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
        <Route path="/compare" element={<ComparePage />} />
      </Routes>
    </>
  );
}
