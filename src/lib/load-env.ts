import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

// Load WebMCPify's local settings even when the command is launched from the
// site being audited. A site-local .env may add values without overriding the
// CLI-level settings.
dotenv.config({ path: path.join(packageRoot, ".env"), quiet: true });
dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });
