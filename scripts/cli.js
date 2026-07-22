export function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) { args._.push(value); continue; }
    const key = value.slice(2);
    if (["dry-run", "confirm"].includes(key)) args[key] = true;
    else {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function requireConfirmation(args) {
  if (!args.confirm) throw new Error("Explicit confirmation required: pass --confirm after reviewing --dry-run output");
}
