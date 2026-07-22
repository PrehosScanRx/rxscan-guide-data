import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/guide-releases.js";

const files = [];
for (const directory of ["lib", "scripts", "test"]) {
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const item = path.join(current, entry.name);
      if (entry.isDirectory()) walk(item);
      else if (entry.name.endsWith(".js")) files.push(item);
    }
  };
  walk(path.join(ROOT, directory));
}
for (const file of files) childProcess.execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
console.log(`JavaScript syntax valid: ${files.length} files`);
