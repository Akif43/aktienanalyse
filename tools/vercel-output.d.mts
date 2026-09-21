export declare const RUNTIME: string;
export declare function buildVercelOutput(options?: {
  outDir?: string;
  staticDir?: string;
  functionsDir?: string;
}): Promise<{ outDir: string; functions: string[] }>;
export declare const MAX_DURATION: Record<string, number>;
