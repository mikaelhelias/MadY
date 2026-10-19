/** Types for `build-platform.mjs` — see that file. */
export function pythonCommand(platform?: string): { command: string; args: string[] };
export function freezeCommand(platform?: string): { command: string; args: string[] };
export function playwrightDir(platform?: string, env?: Record<string, string | undefined>, home?: string): string;
export function ffmpegFileName(platform?: string): string;
