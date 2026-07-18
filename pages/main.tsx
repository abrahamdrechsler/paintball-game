import React from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import PaintMarbles from "../app/paint-marbles";

const root = document.getElementById("root");

if (!root) throw new Error("Paint Pop root element was not found");

createRoot(root).render(
  <React.StrictMode>
    <PaintMarbles />
  </React.StrictMode>,
);
