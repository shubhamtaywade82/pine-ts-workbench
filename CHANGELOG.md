# Changelog

## [0.6.0](https://github.com/shubhamtaywade82/pine-ts-workbench/compare/v0.5.0...v0.6.0) (2026-11-14)


### Features

* **agents:** add documentation for issue tracking and triage processes ([e88e5ee](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/e88e5eef56c317f2af8b90422b4dcae1cc77267c))
* **alma:** add ALMA ribbon template and indicator color mappings ([565afef](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/565afef2872c0e14144bc7a466dec2ccc4169ebb))
* **api:** add CoinDCX and Dhan API routes, enhance symbol search functionality ([92895b3](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/92895b3dd4d660625fc75e5dd4245ca5bd14ee07))
* **api:** add new routes for options data and enhance bot research functionality ([7e9ac45](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/7e9ac45767085b7c4481fa5d8437d2ed9b152237))
* **chart:** enhance chart functionality and improve DOM ladder settings ([c502005](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/c502005fdae1440f76c5e6528b6445fb76d685b0))
* **chart:** enhance live badge functionality and session handling ([fe37e62](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/fe37e625be437957441a793e72588ee888cd712f))
* enhance accessibility and UI responsiveness ([98303bc](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/98303bcf7539fed56de1b81a4d0f41c1c767adf7))
* **microstructure:** enhance market microstructure collector and API functionality ([3411f34](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/3411f34813bf04deddb1576a0f81c87e442dae48))
* **microstructure:** implement market microstructure and order flow plan for Binance Spot ([6cc9cc5](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/6cc9cc56ed62e3dc2c0fda66504cf098a19fc562))
* **microstructure:** implement market microstructure collector and API endpoints ([85bfcbf](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/85bfcbf857e77d548c24cffa6387d921becc0ce5))
* **order-guard:** implement order safety mechanism for alert-triggered orders ([dd6c96f](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/dd6c96f55f14b83f089c1fb0ae8317b411a5546c))
* **trade-flow:** implement trade flow animation and geometry for DOM ladder ([16698e1](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/16698e1a750550649043d6b6a4c06101068241e9))
* **trade-lab:** enhance trading rules with trailing stop functionality and underlying range integration ([626496f](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/626496f9fbb24e17fb29272559c9c67681fc3889))
* update dependencies and enhance README with new features ([554f0a2](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/554f0a2d3848068af8b8a1fc6a1d78274d266a79))


### Performance Improvements

* eliminate UI lag via incremental indicators and decoupled hover ([a097dd6](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/a097dd62ddeb040a5c41d4c31d6533b668ac6d16))

## [0.5.0](https://github.com/shubhamtaywade82/pine-ts-workbench/compare/v0.4.0...v0.5.0) (2026-11-02)


### Features

* **ai:** integrate tev1 decision model and market snapshot contract ([00355f8](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/00355f8ca4a761651c8a3c208caac51148689b07))
* **alerts:** message templates with {{ticker}}/{{close}}/{{interval}}/{{time}} placeholders (P0) ([4db70d5](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/4db70d5958f299895a18de3eee13228aec3fbe6f))
* **dependencies:** add @nemesis-oss/dhanhq-sdk version 1.3.0 to bun.lock ([9bd6dbd](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/9bd6dbd3b7b839e7fba289d1341653e519710646))
* **dhan:** add DhanHQ SDK integration and update README with token management details ([54a7745](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/54a774551b414b3dee41abb63cef70d38287f6c3))
* **dhan:** chart NSE/BSE indices from DhanHQ via the shared algo_scalper_api token ([fe26ba0](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/fe26ba02edef4ab5e1b8b129970adfc320751af8))
* **docs:** in-app docs dialog — examples gallery, ta API reference, Pine-to-TS cheat sheet, hotkeys (P0) ([b361152](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/b36115231d0d5dd515c6e72802ee1d1efcae4907))
* **feed:** provider health badge — tick age, stale detection, bar-gap warnings (P0) ([0598df2](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/0598df24d0e2ee62c9dc9c90716ac2621b3acc79))
* **search:** fuzzy-ranked symbol search with favorites and recents (P0) ([83209ed](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/83209ed3bb16eee9f54dae5283b76fca30017283))
* **tester:** JSON export of full backtest + slippage-unit fill-model control (P0) ([0a5fa0e](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/0a5fa0e9a816637c16910fb9419a5960ccbeab05))
* **token:** implement DhanTokenProvider for managing access tokens with fallback logic and caching ([eb1b992](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/eb1b9920d0cd221ba346a5a67b066803ff2f57f3))
* **watchlist:** live last/chg%/vol columns from Binance ticker stream + drag-reorder (P0) ([d91630b](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/d91630b50fa585894d9beb538e0af6e6974964cf))
* **workbench:** P0 requirements parity — kill switch, environment banner, live watchlist, fuzzy search, health badge, alert templates, docs ([623e3c3](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/623e3c3c9e95e6f7481243d99e0fff4116f0926a))

## [0.4.0](https://github.com/shubhamtaywade82/pine-ts-workbench/compare/v0.3.0...v0.4.0) (2026-11-02)


### Features

* **alerts:** multi-condition rules, persistence, dedupe, watchlist alerts (P5) ([eebd0dd](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/eebd0dd10497cd08a9f13ac9b6ca9ac13060e54c))
* **drawings:** 8 new chart drawing tools — 13-tool core set (P4) ([eda6a50](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/eda6a50091e276e29923a4b719ae872c86c8f600))
* **feed:** second-based 1s interval and 5000-bar deep history ([5ca31a4](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/5ca31a4432fb50296e888a78908aa12cc22953f8))
* **grid:** 16-chart layouts — TradingView Ultimate layout parity (P4) ([ff1824a](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/ff1824a0b526dedfa65df3c7ff6be2306dfae9f3))
* **worker:** 100-second script execution timeout (TradingView Ultimate parity) ([7b2859f](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/7b2859f900e42c4cdb4a82bafbbac08e244fe8e7))

## [0.3.0](https://github.com/shubhamtaywade82/pine-ts-workbench/compare/v0.2.1...v0.3.0) (2026-10-28)


### Features

* add AI ghost text feature in PineEditor ([16b27de](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/16b27de18e21718db5bf2495367db18eb185793e))
* add LastPricePrimitive for enhanced price visualization ([5e3cda6](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/5e3cda639829074092c023b6a315d0bea09f05ca))
* add useTechnicals hook for fetching and computing technical indicators ([ea45758](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/ea45758c9572535427e4320af805ac4a59130462))
* **alerts:** add desktop notification sink, SMC JSON payload parsing, and alert dispatch ([166415c](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/166415ce1d9b465ad6ee037bdf898340cdf7bbc5))
* **api:** implement SavedScript and SavedLayout models with CRUD operations ([a6cd44f](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/a6cd44fbc8f91768f343d9368287ae8ecaf20684))
* **chart:** add bar replay controller and extract cell indicator helpers ([fa5ad44](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/fa5ad4491fcdcb9ba9ed02daa011ec517f8c93ec))
* **chart:** add candle themes and chart types with toolbar and settings selectors ([80c5c9b](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/80c5c9b11d161eba884f2798dfb1f530c5efca6e))
* **chart:** add HTF bar loader, luminous forming marker, and dynamic liquidity status ([3ff4935](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/3ff4935a54b1bc5f4509b56570237319d2e00e82))
* **chart:** add interactive drawing tools toolbar and modularize chart hookups ([b793107](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/b7931075746cb2c744d00ab63ea309a9035c0739))
* **chart:** add live bid and ask price lines with scale badges ([6016e97](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/6016e9723a84d701d09b40ce194b942cb0753d5f))
* **chart:** add switchable depth wall styles with horizontal shelf, right DOM, and micro-bracket ([eb894bc](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/eb894bccbe650f31047d65100a8ded022ca8d01d))
* **chart:** enhance dialog components with descriptions for improved accessibility and user guidance ([295812c](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/295812ccfbf007871ab834885c4ab41d39bcb9ae))
* **chart:** support independent candle body, border, wick and volume colors ([df6419b](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/df6419ba7cb59709bc11066a622b7f352549d08e))
* configurable wall window and minimum size, with honest observation labels ([7c7b000](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/7c7b00082836f0327ff1dd58a6cf46f726537fad))
* configurable wall window and minimum size, with honest observation labels ([1a8deb9](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/1a8deb92d9a063740df4acb1bf8431c04808d30d))
* enhance chart-cell color indicators with additional technical analysis metrics ([64bccb7](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/64bccb73622d0875c2c9038e69cb94aaa2166be6))
* enhance editor and technicals integration in charting components ([c7f17e2](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/c7f17e2acd37552637c83a38241af708b3bd03a4))
* enhance RatingGauge and TechnicalsPanel components for improved responsiveness ([17383d3](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/17383d3733e194b07d13c280c215f6f27db4032e))
* enhance script management and indicator functionality ([6ddb956](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/6ddb9568732bdabdea3e94ea28a6f34dee890102))
* enhance worker message logging in script-worker-client ([7e7247c](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/7e7247cd7b0aefb8b968066e2c7404a1a4e9e80c))
* implement separateLabels function and refactor bubble rendering logic ([5847dce](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/5847dce745be644569c1da7f36103cad9f4a0ab0))
* integrate AI-driven script optimization and error handling in Pine Editor ([ef6d1fe](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/ef6d1fe97e1a0da82ebf01f0aa947aa81bf8f292))
* integrate SMC Confluence Engine and enhance chart drawing capabilities ([701852a](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/701852a66154a73e9cc4ba639f03582c2a6d698f))
* introduce script library and editor enhancements ([9ba8bd3](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/9ba8bd3c3c73fb09ef64afa1d2618091176bd81d))
* live order-book liquidity walls on the forming candle ([4d0d4fd](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/4d0d4fd0785ee254c660e637318cee2d491d7cd5))
* live order-book liquidity walls on the forming candle ([629a7ca](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/629a7cabe7291a41adc9fa4fce4ef5fe255409aa))
* Pine Editor "…" menu, left price scale and Trading chart settings ([8595dcf](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/8595dcf98d5b6a7214a36ef12956d8d930e82860))
* restore UI state across reloads and restarts ([56282f2](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/56282f267b23cc30b9160c928ef6cd74b6cc9e58))
* show trade excursions and margin usage in the Strategy Tester ([9eae099](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/9eae0991f37f2178604b4031baad21e0bb9014ab))
* **smc-confluence:** enhance strategy parameters and add new test cases for multi-swing cycles ([6a61d37](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/6a61d37eda1ed478e2fd07b12017f7064fe7450d))
* **theme:** implement true OLED black dark mode and blend indicator candle aesthetics ([860c1a5](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/860c1a5975ada445d2260c226030daf95f29f21d))
* update dependencies and enhance skills integration ([8458632](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/845863221346325bd95adf97d86a4719e038a1a9))
* **workbench:** add symbol search, SMC strategy template, barcolor rendering, and label collision avoidance ([6d54b92](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/6d54b924e803aaf7ffdfe2251f997767449c9ec0))


### Bug Fixes

* **chart:** render indicator plotted objects on top of chart grid lines ([81de236](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/81de23633a85a2aba85dcb36190a8d643b78a0aa))
* depend on published @nemesis-oss/ollama-sdk so CI can install ([234be14](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/234be1416ff255f127331cd4aaddfbb70dedda04))
* ensure proper cleanup of chart references in ChartWorkbench ([1f3f405](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/1f3f405db75a52cc6d28742db3242d264cc19124))
* **feed:** gracefully close websockets to prevent late ping race errors ([d4f0755](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/d4f0755a51c9db21f91b2ae30337f2346a7c06cc))
* let the AI strategy optimizer run backtests on the server ([95dd7fd](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/95dd7fdcc81654e5f256519d75aa99a3561f8eda))
* manage chart drawings lifecycle in ChartWorkbench ([6b612ff](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/6b612ff618ee4e53de383778b0939edca8405051))
* pin @prisma/client back to 6.x to match the prisma CLI ([606825a](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/606825ab0b8d77a47402504dfdebba6dfb997457))
* refine strategy tester behavior and clean up script library hook ([e2b8dae](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/e2b8daec80e7ab5a9800f977c438e942b2f3d82f))
* resolve tailwindcss from the workbench on the first dev compile ([8454da7](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/8454da7de5d3ea0ed8ae5ec63b168609de6685cd))
* **smc:** align confluence scoring math and setup triggers with institutional crypto master ([e02772e](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/e02772e66e73ddf3d8ff21ee1d929c2f6d0defdf))
* update error message for strategy scripts in indicator runner ([749e16e](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/749e16e00f7b2e0369683c4666a13e13231b31cb))
* validate drawing parameters in editor output ([debce01](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/debce014cdc83987f4da2002722a4544cc63584e))


### Performance Improvements

* re-run only the forming bar of editor and saved scripts ([3670a94](https://github.com/shubhamtaywade82/pine-ts-workbench/commit/3670a9477deae15dcaf376decf736da9765b3f18))
