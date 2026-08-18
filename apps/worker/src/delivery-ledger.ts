import fs from "node:fs";
import path from "node:path";

export function deliveryWasAccepted(databasePath: string | undefined, idempotencyKey: string) {
  const marker = markerPath(databasePath, idempotencyKey, "accepted");
  return marker ? fs.existsSync(marker) : false;
}

export function markDeliveryAccepted(databasePath: string | undefined, idempotencyKey: string) {
  writeMarker(databasePath, idempotencyKey, "accepted");
}

export function deliveryIsUncertain(databasePath: string | undefined, idempotencyKey: string) {
  const marker = markerPath(databasePath, idempotencyKey, "uncertain");
  return marker ? fs.existsSync(marker) : false;
}

export function markDeliveryUncertain(databasePath: string | undefined, idempotencyKey: string) {
  writeMarker(databasePath, idempotencyKey, "uncertain");
}

function writeMarker(databasePath: string | undefined, idempotencyKey: string, state: "accepted" | "uncertain") {
  const marker = markerPath(databasePath, idempotencyKey, state);
  if (!marker) return;
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  try { fs.writeFileSync(marker, new Date().toISOString(), { encoding: "utf8", flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

function markerPath(databasePath: string | undefined, idempotencyKey: string, state: "accepted" | "uncertain") {
  if (!databasePath) return null;
  const fileName = Buffer.from(idempotencyKey, "utf8").toString("base64url");
  return path.join(path.dirname(path.resolve(databasePath)), "delivery-ledger", `${fileName}.${state}`);
}
