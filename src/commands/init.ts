import path from "node:path";
import { writeConfig } from "../lib/config.js";

export interface InitOptions {
  path?: string;
  withTemporal?: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const sitePath = path.resolve(opts.path ?? process.cwd());
  const config = await writeConfig(
    { durable: opts.withTemporal === true },
    sitePath
  );

  if (config.durable) {
    console.log(
      `[init] Temporal durability enabled for ${sitePath}. Run "temporal server start-dev" before using repair.`
    );
  } else {
    console.log(
      `[init] Plain repair loop enabled for ${sitePath}. Re-run with --with-temporal to opt in later.`
    );
  }
  console.log(`[init] configuration saved to ${sitePath}/.webmcpify/config.json`);
}
