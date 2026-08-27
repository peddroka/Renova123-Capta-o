export const PROFILES = {
  dev: ["web", "api"],
  full: ["web", "api", "worker"],
  francisco: ["web", "api", "worker"],
};

export function profileServices(profile) {
  const services = PROFILES[profile];
  if (!services) throw new Error(`Perfil desconhecido: ${profile}`);
  return [...services];
}
