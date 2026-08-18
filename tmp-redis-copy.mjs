import { createClient } from "redis";

const oldClient = createClient({ socket: { host: "127.0.0.1", port: 6381 } });
const currentClient = createClient({ socket: { host: "127.0.0.1", port: 6379 }, password: process.env.REDIS_PASSWORD });
oldClient.on("error", () => {});
currentClient.on("error", () => {});
await oldClient.connect();
await currentClient.connect();
let cursor = "0";
let copied = 0;
do {
  const page = await oldClient.scan(cursor, { COUNT: 1000 });
  cursor = page.cursor;
  for (const key of page.keys) {
    const dump = await oldClient.sendCommand(["DUMP", key]);
    const ttl = await oldClient.pTTL(key);
    if (dump) {
      await currentClient.sendCommand(["RESTORE", key, String(ttl > 0 ? ttl : 0), dump, "REPLACE"]);
      copied += 1;
      console.log(`COPIED ${key}`);
    }
  }
} while (cursor !== "0");
console.log(`COPIED_TOTAL ${copied}`);
await oldClient.quit();
await currentClient.quit();
