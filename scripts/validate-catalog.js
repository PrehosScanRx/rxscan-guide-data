import path from "node:path";
import { ROOT, countCatalog, readJson, validateCatalog } from "../lib/guide-releases.js";
import { parseArgs } from "./cli.js";

const args = parseArgs(process.argv.slice(2));
const catalogPath = path.resolve(args.catalog ?? path.join(ROOT, "catalog", "guideCatalog.json"));
const catalog = validateCatalog(readJson(catalogPath));
console.log(`Catalog valid: ${catalogPath}`);
console.log(JSON.stringify(countCatalog(catalog)));
