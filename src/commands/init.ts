import path from "node:path";

export interface InitOptions {
  path?: string;
  withTemporal?: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const sitePath = path.resolve(opts.path ?? process.cwd());
  if (opts.withTemporal === true) {
    console.log(
      `[init] Temporal durability enabled for this CLI run. Run "temporal server start-dev" before using repair.`
    );
  } else {
    console.log(
      `[init] Plain repair loop enabled for this CLI run. Use --with-temporal when invoking the CLI to opt in.`
    );
  }
  console.log(`[init] no project configuration was written for ${sitePath}`);
}
