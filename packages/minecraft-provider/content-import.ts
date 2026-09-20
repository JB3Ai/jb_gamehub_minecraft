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
    this.executor = new ContentImportExecutor({
      stagingRoot: config.stagingRoot ?? path.join(config.serverDir, ".gamehub-content-staging"),
      managedWorldsRoot: path.join(config.serverDir, "worlds"),
      managedPluginsRoot: path.join(config.serverDir, "plugins"),
      managedResourcePacksRoot: path.join(config.serverDir, "resource_packs"),
      auditLogPath: config.auditLogPath ?? path.join(config.serverDir, "gamehub-content-audit.jsonl"),
    });
  }

  createPlan(request: ContentImportRequest): ContentImportPlan {
    return this.executor.getPlanner().createPlan(request);
  }

  execute(plan: ContentImportPlan, request: ContentImportRequest, approved: boolean): Promise<ContentImportResult> {
    return this.executor.execute(plan, request.item, approved);
  }
}
