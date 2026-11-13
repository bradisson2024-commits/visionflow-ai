import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Home from "./pages/Home";
import SearchRun from "./pages/SearchRun";
import Results from "./pages/Results";
import Niche from "./pages/Niche";
import History from "./pages/History";
import Projects from "./pages/Projects";
import Settings from "./pages/Settings";
import Replica from "./replica/Replica";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/buscando" element={<SearchRun />} />
        <Route path="/resultados/:id" element={<Results />} />
        <Route path="/nicho" element={<Niche />} />
        <Route path="/historial" element={<History />} />
        <Route path="/proyectos" element={<Projects />} />
        <Route path="/replica/:id" element={<Replica />} />
        <Route path="/ajustes" element={<Settings />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
