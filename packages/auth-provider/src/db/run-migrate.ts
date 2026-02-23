import { runMigrations } from "./migrate.js";

runMigrations()
  .then((ran) => {
    if (ran.length > 0) console.log("Ran migrations:", ran.join(", "));
    else console.log("No new migrations.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
