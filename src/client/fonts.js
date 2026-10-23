// Fonts for the text-on-video preview and the font picker, always loaded from Glimpse's own server.
// Full fonts load as "GF <family>"; picker rows use tiny preview fonts named "GFP <family>". Until one arrives
// the text shows in Inter, so nothing is ever blank.
import React from "react";

const { useState, useEffect } = React;
const loads = {};

function load(name, url) {
  if (typeof document === "undefined" || !window.FontFace) return Promise.resolve(false);
  if (!loads[name]) {
    // Each file holds one weight; claiming the whole range stops browsers faking bold, as the renderer does.
    loads[name] = new FontFace(name, "url(" + url + ")", { weight: "100 900" }).load()
      .then((f) => { document.fonts.add(f); return true; })
      .catch(() => { delete loads[name]; return false; });
  }
  return loads[name];
}
const path = (kind, family) => "/api/fonts/" + kind + "/" + encodeURIComponent(family);

export const fontStack = (family) => '"GF ' + family + '", "Inter", system-ui, sans-serif';
export const previewStack = (family) => '"GFP ' + family + '", "GF ' + family + '", "Inter", system-ui, sans-serif';
/** The full font (the server downloads it from Google Fonts first if needed). Resolves to whether it loaded. */
export const loadFont = (family) => load("GF " + family, path("file", family));
export const loadPreview = (family) => load("GFP " + family, path("preview", family));

/** "ready", "loading" or "failed" for a full font, loading it when asked for. */
export function useFont(family) {
  const [state, setState] = useState("loading");
  useEffect(() => {
    let live = true;
    setState("loading");
    loadFont(family).then((ok) => { if (live) setState(ok ? "ready" : "failed"); });
    return () => { live = false; };
  }, [family]);
  return state;
}

/** Load several full fonts; true while any is still loading. */
export function useFontsLoading(families) {
  const key = families.join("|");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let live = true;
    setBusy(true);
    Promise.all(families.map(loadFont)).then(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [key]);
  return busy;
}

// Text width in a loaded font, for laying out the preview exactly as the renderer will.
let ctx = null;
export function measureWith(family) {
  if (!ctx && typeof document !== "undefined") ctx = document.createElement("canvas").getContext("2d");
  return (text, px, weight) => {
    if (!ctx) return text.length * px * 0.55;
    ctx.font = weight + " " + px + "px " + fontStack(family);
    return ctx.measureText(text).width;
  };
}

// The Google Fonts list ships with Glimpse (family, category, weight), loaded only when the picker opens.
let cat = null;
export const catalogue = () => (cat ||= import("../shared/google-fonts.json").then((m) => m.default || m));
export const CATEGORIES = [{ id: "all", label: "All" }, { id: "s", label: "Sans" }, { id: "r", label: "Serif" }, { id: "d", label: "Display" }, { id: "h", label: "Handwriting" }, { id: "m", label: "Mono" }];
export const catName = (c) => (CATEGORIES.find((x) => x.id === c) || CATEGORIES[1]).label;
