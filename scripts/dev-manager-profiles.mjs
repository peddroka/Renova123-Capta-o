export const PROFILES = {
  wolf: ["api", "whisper"],
  dev: ["web", "api", "whisper"],
  full: ["web", "api", "worker", "whisper"],
  francisco: ["web", "api", "worker"],
};

export function profileServices(profile) {
  const services = PROFILES[profile];
  if (!services) throw new Error(`Perfil desconhecido: ${profile}`);
  return [...services];
}
