import { ProviderEvent, WebSocketConnectionState } from "./types";
import { reduceConnectionState } from "./state";

export class DashboardEventStream {
  private readonly url: string;
  private readonly onEvent: (event: ProviderEvent) => void;
  private readonly onConnectionState: (state: WebSocketConnectionState) => void;
  private socket: WebSocket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private closedByUser = false;

  constructor(
    url: string,
    onEvent: (event: ProviderEvent) => void,
    onConnectionState: (state: WebSocketConnectionState) => void,
  ) {
    this.url = url;
    this.onEvent = onEvent;
    this.onConnectionState = onConnectionState;
  }

  connect() {
    this.closedByUser = false;
    this.onConnectionState("connecting");
    this.openSocket();
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.socket?.close();
    this.onConnectionState("disconnected");
  }

  private openSocket() {
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      this.retries = 0;
      this.onConnectionState(reduceConnectionState("connecting", "socket_open"));
    };

    this.socket.onmessage = (message) => {
      try {
        const parsed = JSON.parse(String(message.data)) as ProviderEvent;
        this.onEvent(parsed);
      } catch {
        // Ignore malformed event packets from the transport.
      }
    };

    this.socket.onerror = () => {
      this.onConnectionState(reduceConnectionState("connected", "socket_error"));
    };

    this.socket.onclose = () => {
      if (this.closedByUser) {
        this.onConnectionState("disconnected");
        return;
      }
      this.onConnectionState(reduceConnectionState("connected", "socket_retry"));
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    this.retries += 1;
    const delay = Math.min(1000 * this.retries, 5000);
    this.reconnectTimer = setTimeout(() => {
      if (this.closedByUser) {
        return;
      }
      this.openSocket();
    }, delay);
  }
}
