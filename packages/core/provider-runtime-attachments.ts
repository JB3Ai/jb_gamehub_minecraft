import { ProvisioningApplyException } from "./provisioning-apply-contracts";
import { freezeProvisioningData } from "./provisioning";
import type { RuntimeAttachmentAdapter, RuntimeAttachmentRecord } from "./runtime-attachment";

/** Provider-owned metadata collection; it does not alter legacy lifecycle dispatch. */
export abstract class ProviderRuntimeAttachments implements RuntimeAttachmentAdapter {
  private readonly records = new Map<string, RuntimeAttachmentRecord>();
  abstract inspect: RuntimeAttachmentAdapter["inspect"];
  attach(record: RuntimeAttachmentRecord, fence: () => void): void {
    fence();
    const existing = this.records.get(record.descriptor.serverId);
    if (existing && (existing.effectId !== record.effectId || existing.digest !== record.digest)) throw new ProvisioningApplyException({ code: "ATTACHMENT_CONFLICT", message: "Provider already owns an incompatible attachment." });
    this.records.set(record.descriptor.serverId, freezeProvisioningData(JSON.parse(JSON.stringify(record))) as RuntimeAttachmentRecord);
  }
  detach(effectId: string, fence: () => void): void {
    fence();
    for (const [id, record] of this.records) if (record.effectId === effectId) this.records.delete(id);
  }
  list(): RuntimeAttachmentRecord[] { return [...this.records.values()]; }
}
