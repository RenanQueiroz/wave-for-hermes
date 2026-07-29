#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

const MINIMUM_JAVA_MAJOR = 17;
const MAXIMUM_JAVA_MAJOR = 21;

function addCandidate(candidates, candidate) {
  if (!candidate || candidates.includes(candidate)) {
    return;
  }

  candidates.push(candidate);
}

function javaMajor(javaHome) {
  const executable = join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!existsSync(executable)) {
    return undefined;
  }

  const result = spawnSync(executable, ["-version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = output.match(/version "(?:1\.)?(\d+)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function macJavaHomes() {
  const homes = [];
  const root = "/Library/Java/JavaVirtualMachines";
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      homes.push(join(root, entry, "Contents", "Home"));
    }
  }

  homes.push("/Applications/Android Studio.app/Contents/jbr/Contents/Home");
  return homes;
}

function windowsJavaHomes() {
  const homes = [];
  for (const root of [
    process.env.PROGRAMFILES,
    process.env.LOCALAPPDATA,
    process.env["PROGRAMFILES(X86)"],
  ]) {
    if (root) {
      homes.push(join(root, "Android", "Android Studio", "jbr"));
    }
  }
  return homes;
}

function linuxJavaHomes() {
  const homes = ["/opt/android-studio/jbr", "/usr/local/android-studio/jbr"];
  const root = "/usr/lib/jvm";
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      homes.push(join(root, entry));
    }
  }
  return homes;
}

function compatibleJavaHome() {
  const candidates = [];
  addCandidate(candidates, process.env.JAVA_HOME);
  addCandidate(candidates, process.env.JDK_HOME);

  const platformHomes =
    process.platform === "darwin"
      ? macJavaHomes()
      : process.platform === "win32"
        ? windowsJavaHomes()
        : linuxJavaHomes();

  for (const candidate of platformHomes) {
    addCandidate(candidates, candidate);
  }

  const compatible = candidates
    .map((home) => ({ home, major: javaMajor(home) }))
    .filter(
      (candidate) =>
        candidate.major !== undefined &&
        candidate.major >= MINIMUM_JAVA_MAJOR &&
        candidate.major <= MAXIMUM_JAVA_MAJOR,
    )
    .sort((left, right) => {
      const leftRank = left.major === 17 ? 0 : left.major === 21 ? 1 : 2;
      const rightRank = right.major === 17 ? 0 : right.major === 21 ? 1 : 2;
      return leftRank - rightRank;
    });

  return compatible[0];
}

const java = compatibleJavaHome();

console.log("NODE_ENV=development");
if (java) {
  console.log(`JAVA_HOME=${java.home}`);
} else {
  console.error(
    [
      `Radon IDE needs JDK ${MINIMUM_JAVA_MAJOR}-${MAXIMUM_JAVA_MAJOR} for Android builds.`,
      "Install JDK 17 or Android Studio, then restart VS Code.",
      `PATH entries inspected: ${(process.env.PATH ?? "").split(delimiter).length}`,
    ].join(" "),
  );
}
