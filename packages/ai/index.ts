export interface CopilotRequest {
  serverId: string;
  prompt: string;
}

export interface CopilotResponse {
  answer: string;
  actionTaken?: string;
}
