# Changelog

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
