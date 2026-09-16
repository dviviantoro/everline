import { config } from "dotenv";
config();

import { app } from "./app";
import { ensureBucket } from "./storage";

const PORT = Number(process.env.PORT ?? 3001);

async function main() {
  await ensureBucket();
  app.listen(PORT, () => {
    console.log(`EverLine API listening on :${PORT} — docs at /docs`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
