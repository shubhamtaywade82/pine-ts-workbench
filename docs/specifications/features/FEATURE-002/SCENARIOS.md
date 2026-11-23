Feature: CoinDCX Read-Only Portfolio and Positions

  Scenario: User sets API credentials and connects
    Given the user is on the CoinDCX dashboard page
    When the user inputs a valid API Key and API Secret
    Then the connection status displays Connected and account balances are loaded

  Scenario: User views active positions on the CoinDCX dashboard
    Given the user has active futures positions on CoinDCX
    When the CoinDCX dashboard page is loaded
    Then each active position displays pair, side, size, entry price, liquidation price, and unrealized PnL

  Scenario: Active position displays on the chart
    Given the user has an active LONG position on BTCUSDT
    When the chart workbench displays BTCUSDT
    Then horizontal lines for entry price and liquidation price are drawn on the chart

  Scenario: Currency formatting differentiates INR and USDT contracts
    Given the user has an active position with margin currency INR
    When the CoinDCX dashboard page or chart badge is rendered
    Then all monetary fields are formatted with the Rupee symbol ₹

  Scenario: Live WebSocket streams updates without polling
    Given the user has connected valid CoinDCX credentials
    When a df-position-update is emitted on the WebSocket channel
    Then the active positions list updates in real time without a REST refresh

  Scenario: Order placement is prohibited
    Given any user or automated request
    When an order creation endpoint is invoked
    Then the request is rejected with HTTP 403 Forbidden
