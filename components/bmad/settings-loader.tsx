"use client";

import { useEffect } from "react";
import { useStudio } from "@/lib/store";

/** Loads JSON-backed settings + projects once on app mount (all pages). */
export function SettingsLoader() {
  useEffect(() => {
    void useStudio.getState().loadSettings();
    void useStudio.getState().loadProjects();
  }, []);
  return null;
}
