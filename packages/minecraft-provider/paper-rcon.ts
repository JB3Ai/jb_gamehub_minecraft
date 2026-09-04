import net from "net";

interface RconResponse {
  id: number;
  type: number;
  body: string;
}

const SERVER_DATA = 0;
const SERVER_AUTH_RESPONSE = 2;
const SERVER_EXECCOMMAND_RESPONSE = 0;
const SERVER_AUTH = 3;
const SERVER_EXECCOMMAND = 2;

function encodePacket(id: number, type: number, body: string): Buffer {
  const payload = Buffer.concat([
    Buffer.from(Int32LE(id)),
    Buffer.from(Int32LE(type)),
    Buffer.from(body, "utf8"),
    Buffer.from([0, 0]),
  ]);
  return Buffer.concat([  Buffer.from(Int32LE(payload.length)), payload]);
}

function readInt32(buffer: Buffer, offset: number): number {
  return buffer.readInt32LE(offset);
}

function Int32LE(value: number): Uint8Array {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value, 0);
  return buffer;
}

export interface PaperRconConfig {
  host: string;
  port: number;
  password: string;
  timeoutMs?: number;
}

export class PaperRconAdapter {
  private readonly timeoutMs: number;
  private nextId = 1;

  constructor(private readonly config: PaperRconConfig) {
    this.timeoutMs = config.timeoutMs ?? 3000;
    if (!config.password) {
      throw new Error("Paper RCON password is required for player enforcement.");
    }
  }

  async execute(command: string): Promise<string> {
    const socket = net.createConnection({ host: this.config.host, port: this.config.port });
    socket.setTimeout(this.timeoutMs);
    const authId = this.nextId++;
    const commandId = this.nextId++;
    let buffer = Buffer.alloc(0);
    let authenticated = false;
    let commandResponse: RconResponse | undefined;

    return new Promise<string>((resolve, reject) => {
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };

      const consume = () => {
        while (buffer.length >= 4) {
          const length = readInt32(buffer, 0);
          if (length < 10 || buffer.length < length + 4) {
            return;
          }
          const packet = buffer.subarray(4, length + 4);
          buffer = buffer.subarray(length + 4);
          const response: RconResponse = {
            id: readInt32(packet, 0),
            type: readInt32(packet, 4),
            body: packet.subarray(8, packet.length - 2).toString("utf8"),
          };
          if (!authenticated) {
            if (response.id !== authId || response.type !== SERVER_AUTH_RESPONSE) {
              fail(new Error("Paper RCON authentication failed."));
              return;
            }
            authenticated = true;
            socket.write(encodePacket(commandId, SERVER_EXECCOMMAND, command));
            continue;
          }
          if (response.id === commandId && response.type === SERVER_EXECCOMMAND_RESPONSE) {
            commandResponse = response;
            socket.end();
            resolve(response.body);
            return;
          }
        }
      };

      socket.on("connect", () => {
        socket.write(encodePacket(authId, SERVER_AUTH, this.config.password));
      });
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        consume();
      });
      socket.on("timeout", () => fail(new Error("Paper RCON request timed out.")));
      socket.on("error", (error) => fail(error));
      socket.on("close", () => {
        if (!commandResponse) {
          reject(new Error("Paper RCON connection closed before command response."));
        }
      });
    });
  }

  async listPlayers(): Promise<string[]> {
    const response = await this.execute("list");
    const match = response.match(/There are \d+ of a max of \d+ players online:?\s*(.*)$/i);
    if (!match || !match[1].trim()) {
      return [];
    }
    return match[1].split(",").map((name) => name.trim()).filter(Boolean);
  }

  async kickPlayer(player: string, reason: string): Promise<void> {
    await this.execute(`kick ${JSON.stringify(player)} ${JSON.stringify(reason)}`);
    const remaining = await this.listPlayers();
    if (remaining.includes(player)) {
      throw new Error(`Paper did not remove player ${player} after kick command.`);
    }
  }
}
