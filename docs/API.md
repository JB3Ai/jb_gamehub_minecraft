# API.md - API Specifications

## REST Endpoints

### `GET /api/health`
Returns current server health status.

### `GET /api/servers`
Retrieves list of managed Minecraft server instances.

### `POST /api/servers/:id/power`
Executes power toggle (`start`, `stop`, `restart`) on the target server.

### `POST /api/console/command`
Dispatches an RCON command string directly to the active server instance.

### `POST /api/copilot/prompt`
Sends natural language admin commands to Gemini 3.6 Flash for automated execution.
