export declare class AttachmentRootError extends Error {
    reason: string;
    constructor(reason: string, message: string);
}
export declare function parseAttachmentRoots(raw: string | null | undefined): string[];
export declare function resolveAttachmentRootsFromEnv(env?: NodeJS.ProcessEnv): string[];
export declare function isPathInsideRoot(resolvedPath: string, resolvedRoot: string): boolean;
/**
 * Validate staged path is under an allowlisted root, is a regular file,
 * not a symlink, and not hard-linked (nlink > 1).
 */
export declare function assertSafeStagedAttachmentPath(requestedPath: string, roots: string[]): {
    absolutePath: string;
    sizeBytes: number;
    deviceId: string | number;
    inode: string | number;
    nlink: number;
    mtimeMs: number;
};
