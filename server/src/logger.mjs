import pino from "pino";

export function createLogger(config) {
  return pino({
    level: config.logLevel,
    base: { service: "finpro-api", env: config.env },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: ["password", "*.password", "newPassword", "currentPassword"], censor: "[redacted]" },
  });
}
