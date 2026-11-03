/** Serialized sibling-temp-file write followed by an atomic replacement. */
export function atomicWrite(path: string, data: string, options?: { allowCopyFallback?: boolean }): Promise<void>;
