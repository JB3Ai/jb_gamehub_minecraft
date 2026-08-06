# DATABASE.md - Data Models & Schema Specifications

## Data Schemas

### Server Instance (`ServerInstance`)
```json
{
  "id": "srv_survival_01",
  "name": "Home Survival",
  "type": "Paper",
  "version": "1.21.4",
  "status": "online",
  "ip": "survival.jb3gamehub.net",
  "port": 25565,
  "playersOnline": 12,
  "maxPlayers": 20,
  "cpuPercent": 18,
  "ramUsageGb": 5.3,
  "ramMaxGb": 16.0,
  "tps": 20.0,
  "worldCount": 3,
  "pluginCount": 18,
  "geyserBridgeEnabled": true,
  "tagline": "Main Survival World with Geyser Crossplay"
}
```

### Player Session (`Player`)
```json
{
  "id": "p_1",
  "username": "JonoB",
  "uuid": "069a79f4-44e9-4726-a5be-f25138c273e1",
  "ping": 18,
  "world": "world_nether",
  "isOp": true,
  "gamemode": "survival",
  "joinedAt": "2026-08-06T04:12:00Z"
}
```

### Server Properties (`ServerProperties`)
```json
{
  "motd": "Welcome to JB³ GameHub Survival!",
  "viewDistance": 10,
  "simulationDistance": 8,
  "maxPlayers": 20,
  "difficulty": "hard",
  "gamemode": "survival",
  "pvp": true,
  "allowFlight": false,
  "whiteList": false,
  "onlineMode": true,
  "spawnProtection": 16,
  "hardcore": false
}
```
