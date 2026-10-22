import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SetupConfigurationError, type SetupConfigurationRepository, type SetupConfigurationRecord, type SetupSettings } from "./setup-configuration";
import { OnboardingError, type OnboardingState } from "./onboarding";

export class SqliteSetupConfigurationRepository implements SetupConfigurationRepository {
  constructor(private readonly database: () => DatabaseSync) {}
  read(): SetupConfigurationRecord | undefined {
    const row = this.database().prepare("SELECT data FROM setup_configuration WHERE host_id='local'").get();
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  onboarding(): OnboardingState {
    const row = this.database().prepare("SELECT data FROM onboarding_state WHERE host_id='local'").get();
    return row ? JSON.parse(String(row.data)) : { schemaVersion: 1, status: "INCOMPLETE", configurationRevision: this.read()?.revision ?? 0 };
  }
  completeOnboarding(configurationRevision: number, catalogDigest: string, actor: string, now: string): OnboardingState {
    const db = this.database(); db.exec("BEGIN IMMEDIATE");
    try {
      const configuration = this.read();
      if (!configuration) throw new OnboardingError("ONBOARDING_NOT_READY");
      if (configuration.revision !== configurationRevision) throw new OnboardingError("CONFIGURATION_STALE");
      if (configuration.catalogDigest !== catalogDigest || configuration.configuredEnoughToProceed !== true) throw new OnboardingError("ONBOARDING_NOT_READY");
      const current = this.onboarding();
      if (current.status === "READY") { db.exec("COMMIT"); return current; }
      const ready: OnboardingState = { schemaVersion: 1, status: "READY", configurationRevision, completedAt: now, completedBy: actor };
      db.prepare("INSERT INTO onboarding_state(host_id,data) VALUES ('local',?)").run(JSON.stringify(ready));
      db.prepare("INSERT INTO audit_log(id,timestamp,actor,action,result,metadata) VALUES (?,?,?,?,?,?)").run(randomUUID(), now, actor, "setup.onboarding.completed", "completed", JSON.stringify({ configurationRevision }));
      db.exec("COMMIT"); return ready;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  save(settings: SetupSettings, expectedRevision: number, catalogDigest: string, actor: string, now: string) {
    const db = this.database(); db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.read();
      if ((current?.revision ?? 0) !== expectedRevision) throw new SetupConfigurationError("CONFIGURATION_STALE", 409);
      const same = current && current.catalogDigest === catalogDigest && Object.entries(settings).every(([key, value]) => current[key as keyof SetupConfigurationRecord] === value) && current.javaRuntimeId === settings.javaRuntimeId && current.bedrockRuntimeId === settings.bedrockRuntimeId;
      if (same) { db.exec("COMMIT"); return { record: current, unchanged: true }; }
      const record: SetupConfigurationRecord = { ...settings, schemaVersion: 1, hostId: "local", revision: expectedRevision + 1, updatedAt: now, updatedBy: actor, catalogDigest, configuredEnoughToProceed: true };
      db.prepare("INSERT INTO setup_configuration(host_id,revision,data) VALUES ('local',?,?) ON CONFLICT(host_id) DO UPDATE SET revision=excluded.revision,data=excluded.data").run(record.revision, JSON.stringify(record));
      db.prepare("INSERT INTO audit_log(id,timestamp,actor,action,result,metadata) VALUES (?,?,?,?,?,?)").run(randomUUID(), now, actor, "setup.configuration.saved", "completed", JSON.stringify({ hostId: "local", revision: record.revision, catalogDigest }));
      db.exec("COMMIT"); return { record, unchanged: false };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
}
