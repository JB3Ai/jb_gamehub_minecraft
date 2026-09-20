import path from "node:path";
import { ContentImportExecutor, ContentImportPlanner } from "../content-library/importer";
import type { ContentImportPlan, ContentImportRequest, ContentImportResult } from "../content-library/types";

export interface MinecraftContentImportAdapterConfig {
  serverDir: string;
  stagingRoot?: string;
  auditLogPath?: string;
}

/**
 * Minecraft-owned mapping from neutral import plans to managed Paper content
 * directories. Core only deals in ContentImportPlan; it never chooses Paper
 * paths or performs filesystem mutation itself.
 */
export class MinecraftContentImportAdapter {
  private readonly executor: ContentImportExecutor;

  constructor(config: MinecraftContentImportAdapterConfig) {
    const managedRoot = path.join(config.serverDir, "gamehub-managed-content");
    this.executor = new ContentImportExecutor({
      stagingRoot: config.stagingRoot ?? path.join(managedRoot, "staging"),
      managedWorldsRoot: path.join(managedRoot, "worlds"),
      managedPluginsRoot: path.join(managedRoot, "plugins"),
      managedResourcePacksRoot: path.join(managedRoot, "resource-packs"),
      auditLogPath: config.auditLogPath ?? path.join(managedRoot, "audit", "content-import.jsonl"),
    });
  }

  createPlan(request: ContentImportRequest): ContentImportPlan {
    return this.executor.getPlanner().createPlan(request);
  }

  execute(plan: ContentImportPlan, request: ContentImportRequest, approved: boolean): Promise<ContentImportResult> {
    return this.executor.execute(plan, request.item, approved);
  }
}
