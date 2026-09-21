import type { ScoredEntry } from 'ctxjev-core';
export type PreservedContext = {
    goal: string;
    scoredAt: string;
    entries: Array<ScoredEntry & {
        content: string;
    }>;
};
export declare function writePreservedContext(cwd: string, data: PreservedContext): Promise<void>;
export declare function readPreservedContext(cwd: string): Promise<PreservedContext | undefined>;
