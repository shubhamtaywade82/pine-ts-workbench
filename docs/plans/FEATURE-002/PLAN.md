# Implementation Plan: FEATURE-002 CoinDCX Read-Only Portfolio

```json
{
  "featureId": "FEATURE-002",
  "tasks": [
    {
      "id": "TASK-001",
      "description": "Core CoinDCX client library for HMAC signing and read-only queries with INR/USDT support",
      "acceptanceCriteria": [
        "HMAC-SHA256 request signature generates correctly",
        "Read-only queries normalize balances and positions for both INR and USDT margin modes",
        "Positions endpoint uses epoch timestamp in seconds",
        "Strictly no order placement methods"
      ],
      "verification": {
        "command": ["bun", "test", "src/lib/coindcx-client.test.ts"],
        "expectedStatus": "passed"
      },
      "dependencies": [],
      "likelyFiles": ["src/lib/coindcx-client.ts", "src/lib/coindcx-client.test.ts"],
      "estimatedScope": "m",
      "risk": "low"
    },
    {
      "id": "TASK-002",
      "description": "Client-side settings storage, live WebSocket stream client, and portfolio hook",
      "acceptanceCriteria": [
        "API Key and Secret load and save safely to localStorage",
        "WebSocket client connects to stream.coindcx.com and authenticates on coindcx channel",
        "Listens for df-position-update, df-order-update, and balance-update in real time",
        "useCoindcxPortfolio hook provides live stream status and falls back to polling only if disconnected"
      ],
      "verification": {
        "command": ["bun", "test", "src/lib/coindcx-ws.test.ts"],
        "expectedStatus": "passed"
      },
      "dependencies": ["TASK-001"],
      "likelyFiles": ["src/lib/coindcx-settings.ts", "src/lib/coindcx-ws.ts", "src/lib/coindcx-ws.test.ts", "src/hooks/use-coindcx-portfolio.ts"],
      "estimatedScope": "m",
      "risk": "low"
    },
    {
      "id": "TASK-003",
      "description": "Next.js API proxy routes for CoinDCX account, positions, and orders",
      "acceptanceCriteria": [
        "Proxy routes forward credentials and return CoinDCX responses",
        "Order mutation endpoints reject with 403 Forbidden"
      ],
      "verification": {
        "command": ["bun", "run", "typecheck"],
        "expectedStatus": "passed"
      },
      "dependencies": ["TASK-001"],
      "likelyFiles": ["src/app/api/coindcx/account/route.ts", "src/app/api/coindcx/positions/route.ts", "src/app/api/coindcx/orders/route.ts"],
      "estimatedScope": "m",
      "risk": "low"
    },
    {
      "id": "TASK-004",
      "description": "Chart drawings and HUD for active CoinDCX positions",
      "acceptanceCriteria": [
        "Position price lines and liquidation lines map to ChartDrawing format",
        "Pair matching supports both CoinDCX and Binance symbols",
        "Position HUD displays on matching chart"
      ],
      "verification": {
        "command": ["bun", "test", "src/lib/coindcx-chart-levels.test.ts"],
        "expectedStatus": "passed"
      },
      "dependencies": ["TASK-001", "TASK-002"],
      "likelyFiles": ["src/lib/coindcx-chart-levels.ts", "src/lib/coindcx-chart-levels.test.ts", "src/components/chart/chart-cell.tsx"],
      "estimatedScope": "m",
      "risk": "low"
    },
    {
      "id": "TASK-005",
      "description": "Dedicated CoinDCX page and top toolbar navigation",
      "acceptanceCriteria": [
        "Page renders account balance, active positions, open orders",
        "API Key settings dialog / card allows testing and saving keys",
        "Navigation link in TopToolbar allows easy access"
      ],
      "verification": {
        "command": ["bun", "run", "typecheck"],
        "expectedStatus": "passed"
      },
      "dependencies": ["TASK-002", "TASK-003", "TASK-004"],
      "likelyFiles": ["src/app/coindcx/page.tsx", "src/components/chart/top-toolbar.tsx"],
      "estimatedScope": "l",
      "risk": "medium"
    }
  ],
  "edges": [
    { "from": "TASK-001", "to": "TASK-002", "reason": "Settings and hook depend on client types" },
    { "from": "TASK-001", "to": "TASK-003", "reason": "Proxy routes use client fetch functions" },
    { "from": "TASK-001", "to": "TASK-004", "reason": "Chart levels use normalized position types" },
    { "from": "TASK-002", "to": "TASK-004", "reason": "Chart cell uses settings and portfolio data" },
    { "from": "TASK-002", "to": "TASK-005", "reason": "Dashboard page uses portfolio hook" },
    { "from": "TASK-003", "to": "TASK-005", "reason": "Dashboard page calls proxy routes" },
    { "from": "TASK-004", "to": "TASK-005", "reason": "Dashboard links to chart views" }
  ],
  "verticalSlices": [
    ["TASK-001", "TASK-002", "TASK-003", "TASK-004", "TASK-005"]
  ]
}
```
