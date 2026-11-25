#!/usr/bin/env node
// Capacitor's update step (`npx cap sync` / `npx cap update`, package.json "capacitor:update:after") rewrites
// ios/App/CapApp-SPM/Package.swift with the app's deployment target (.iOS(.v18)) but an older tools version (5.9),
// which can't name iOS 18. This raises the tools version to 6.0 so the package resolves.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(import.meta.dirname, "../ios/App/CapApp-SPM/Package.swift");
if (existsSync(file)) {
  const text = readFileSync(file, "utf8");
  const fixed = text.replace(/^\/\/ swift-tools-version: 5\.\d+/m, "// swift-tools-version: 6.0");
  if (fixed !== text) writeFileSync(file, fixed);
}
