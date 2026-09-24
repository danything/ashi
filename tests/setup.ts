import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** 単体テストの環境。import より先に(bunfig.toml の preload) */
export const TMP = join(import.meta.dir, ".tmp");
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.ASHI_HOME = join(TMP, "runtime");
process.env.ASHI_WALK = "0";
process.env.ENTRA_TENANT_ID = "tenant-1";
process.env.ENTRA_CLIENT_ID = "client-1";
process.env.ENTRA_CLIENT_SECRET = "secret";
process.env.SESSION_SECRET = "x".repeat(40);
delete process.env.ENTRA_ROLE;
