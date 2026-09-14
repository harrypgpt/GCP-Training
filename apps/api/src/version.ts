/**
 * Application version, surfaced by the health endpoint.
 * Kept as a standalone constant so it can be replaced at build time later
 * (e.g. injected from CI) without touching feature code.
 */
export const APP_VERSION = process.env.APP_VERSION ?? '0.1.0';
