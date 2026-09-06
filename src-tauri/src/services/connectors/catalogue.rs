//! Every data source this project has wired, declined, or written down.
//!
//! # The rule this file follows
//!
//! **A field is filled in only where somebody read the terms.** Rate limits, risk levels, auth
//! types and attribution appear on `Wired` and `Declined` entries, because those went through
//! the ADR-008 review and the result is in `docs/PROVIDERS.md`. Candidates carry a name, a
//! category and a sentence saying what they serve — and nothing else.
//!
//! That restraint is the feature. A table of a hundred sources with a plausible rate limit
//! beside each would assert a hundred reviews that never happened, in the most convincing
//! possible format, inside an app whose whole premise is that a number arrives with its
//! provenance. The candidate list is a queue of work, and it says so.
//!
//! # Adding one
//!
//! Read the terms. Record them in `docs/PROVIDERS.md`. Write the adapter and its tests. Then
//! change `stage` here and fill in the rest. Not in the other order.

use crate::models::{ConnectorAuth, ConnectorCategory, ConnectorStage, TermsRisk};

pub struct Entry {
    pub id: &'static str,
    pub name: &'static str,
    pub category: ConnectorCategory,
    pub stage: ConnectorStage,
    pub summary: &'static str,
    pub auth: Option<ConnectorAuth>,
    pub risk: Option<TermsRisk>,
    pub free_tier: Option<&'static str>,
    pub attribution: Option<&'static str>,
    pub docs: Option<&'static str>,
    pub note: Option<&'static str>,
    /// The `Envelope.meta.providerId` this source's data arrives under.
    pub provider_id: Option<&'static str>,
}

/// A source nobody has reviewed. Name, category, and what it serves.
fn candidate(
    id: &'static str,
    name: &'static str,
    category: ConnectorCategory,
    summary: &'static str,
) -> Entry {
    Entry {
        id,
        name,
        category,
        stage: ConnectorStage::Candidate,
        summary,
        auth: None,
        risk: None,
        free_tier: None,
        attribution: None,
        docs: None,
        note: None,
        provider_id: None,
    }
}

/// A candidate with something already known about it that a reviewer should see first.
fn candidate_noted(
    id: &'static str,
    name: &'static str,
    category: ConnectorCategory,
    summary: &'static str,
    note: &'static str,
) -> Entry {
    Entry {
        note: Some(note),
        ..candidate(id, name, category, summary)
    }
}

/// Reviewed, and the answer was no. The reason is the point of the entry.
fn declined(
    id: &'static str,
    name: &'static str,
    category: ConnectorCategory,
    summary: &'static str,
    note: &'static str,
) -> Entry {
    Entry {
        stage: ConnectorStage::Declined,
        note: Some(note),
        ..candidate(id, name, category, summary)
    }
}

/// The full catalogue, wired first.
pub fn entries() -> Vec<Entry> {
    let mut all = wired();
    all.extend(declined_entries());
    all.extend(candidates());
    all
}

/// The eleven adapters that exist, with the terms recorded in `docs/PROVIDERS.md`.
fn wired() -> Vec<Entry> {
    vec![
        Entry {
            id: "coingecko",
            name: "CoinGecko",
            category: ConnectorCategory::CryptoMarket,
            stage: ConnectorStage::Wired,
            summary: "Crypto prices, market caps and charts across thousands of assets.",
            auth: Some(ConnectorAuth::Mixed),
            risk: Some(TermsRisk::CoreOk),
            free_tier: Some(
                "Keyless tier is lower and explicitly not guaranteed stable, so the adapter is \
                 configured at 50 calls/min. A free Demo key raises it to 100/min and 10,000 \
                 calls/month — the monthly cap is the binding one in practice.",
            ),
            attribution: Some("Data provided by CoinGecko"),
            docs: Some("https://www.coingecko.com/en/api"),
            note: None,
            provider_id: Some("coingecko"),
        },
        Entry {
            id: "finnhub",
            name: "Finnhub",
            category: ConnectorCategory::EquitiesMarket,
            stage: ConnectorStage::Wired,
            summary: "Equity quotes, company profiles and news.",
            auth: Some(ConnectorAuth::ApiKey),
            risk: Some(TermsRisk::CoreOk),
            free_tier: Some("60 requests/minute on the free plan. Every endpoint needs the key."),
            attribution: Some("Market data by Finnhub"),
            docs: Some("https://finnhub.io/docs/api"),
            note: Some(
                "Quotes are one symbol per call, so a watchlist costs one request per row — \
                 which is what Atlas's rotation manager counts.",
            ),
            provider_id: Some("finnhub"),
        },
        Entry {
            id: "alphavantage",
            name: "Alpha Vantage",
            category: ConnectorCategory::EquitiesMarket,
            stage: ConnectorStage::Wired,
            summary: "Daily equity OHLCV history.",
            auth: Some(ConnectorAuth::ApiKey),
            risk: Some(TermsRisk::Tight),
            free_tier: Some("25 requests per day."),
            attribution: None,
            docs: Some("https://www.alphavantage.co/documentation/"),
            note: Some(
                "Charts only, and deliberately so: 25 requests a day cannot serve quotes or \
                 search, and its `quotes()` returns an empty list on purpose rather than \
                 half-working. See ADR-013 and ADR-039.",
            ),
            provider_id: Some("alphavantage"),
        },
        Entry {
            id: "fred",
            name: "FRED (St. Louis Fed)",
            category: ConnectorCategory::Macro,
            stage: ConnectorStage::Wired,
            summary: "US macro series — Treasury yields, CPI, unemployment, the dollar index.",
            auth: Some(ConnectorAuth::Keyless),
            risk: Some(TermsRisk::CoreOk),
            free_tier: Some(
                "No published limit on the CSV download endpoint, which is what this uses. The \
                 JSON API wants a key; the CSV one does not.",
            ),
            attribution: Some(
                "Data from FRED, Federal Reserve Bank of St. Louis. US government output in the \
                 public domain.",
            ),
            docs: Some("https://fred.stlouisfed.org/docs/api/fred/"),
            note: Some(
                "Not switchable in Settings: the macro service constructs it directly rather \
                 than routing through the provider registry. It requires no credential and \
                 serves no market data, so there has never been anything to configure.",
            ),
            provider_id: Some("fred"),
        },
        Entry {
            id: "alternative-me",
            name: "Alternative.me Fear & Greed",
            category: ConnectorCategory::CryptoMarket,
            stage: ConnectorStage::Wired,
            summary: "The crypto Fear & Greed index, as its publisher computes it.",
            auth: Some(ConnectorAuth::Keyless),
            risk: Some(TermsRisk::CoreOk),
            free_tier: Some("No published limit. Cached for three hours — it is a daily figure."),
            attribution: Some("Crypto Fear & Greed Index by Alternative.me"),
            docs: Some("https://alternative.me/crypto/fear-and-greed-index/"),
            note: Some(
                "Reported, never recomputed. The equity equivalent is computed here instead, \
                 because the well-known equity index has no public API — and that difference is \
                 labelled on screen.",
            ),
            provider_id: Some("alternative-me"),
        },
        Entry {
            id: "rss",
            name: "RSS and Atom feeds",
            category: ConnectorCategory::News,
            stage: ConnectorStage::Wired,
            summary: "Headlines from feeds the user chooses, including SEC and Federal Reserve \
                      press releases.",
            auth: Some(ConnectorAuth::Keyless),
            risk: Some(TermsRisk::CoreOk),
            free_tier: Some(
                "Per-publisher. The app reads the user's own feed list and no default feed is \
                 polled more than once every ten minutes.",
            ),
            attribution: Some("Each item is rendered with its source publication and link."),
            docs: None,
            note: Some(
                "A feed is a published invitation to fetch it. Autodiscovery reads a site's own \
                 `<link rel=\"alternate\">` declarations and is not scraping — ADR-038.",
            ),
            provider_id: Some("rss"),
        },
        Entry {
            id: "worldbank",
            name: "World Bank Open Data",
            category: ConnectorCategory::Macro,
            stage: ConnectorStage::Wired,
            summary: "Country indicators — inflation, GDP growth, debt, current account, \
                      unemployment.",
            auth: Some(ConnectorAuth::Keyless),
            risk: Some(TermsRisk::CoreOk),
            free_tier: Some("No published limit. One request covers every indicator and country."),
            attribution: Some("World Bank Open Data, licensed CC BY 4.0"),
            docs: Some(
                "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation",
            ),
            note: Some(
                "`mrnev=1` returns the most recent non-empty value however old it is — the \
                 latest German debt figure it holds is from 1990. Observations over five years \
                 old are dropped. See ADR-040.",
            ),
            provider_id: Some("worldbank"),
        },
        Entry {
            id: "frankfurter",
            name: "Frankfurter",
            category: ConnectorCategory::Fx,
            stage: ConnectorStage::Wired,
            summary: "Reference exchange rates aggregated from central bank publications.",
            auth: Some(ConnectorAuth::Keyless),
            risk: Some(TermsRisk::CoreOk),
            free_tier: Some(
                "No quotas. Rate-limited against abuse only, and self-hostable if that ever \
                 matters.",
            ),
            attribution: Some("Exchange rates from Frankfurter, over central bank reference rates"),
            docs: Some("https://frankfurter.dev"),
            note: Some(
                "Reference rates, not dealing rates. Central banks publish once a working day, \
                 so over a weekend the newest figure is Friday's and the screen says so.",
            ),
            provider_id: Some("frankfurter"),
        },
        Entry {
            id: "usgs",
            name: "USGS Earthquake Hazards",
            category: ConnectorCategory::Geospatial,
            stage: ConnectorStage::Wired,
            summary: "Worldwide earthquake feeds, regenerated every minute.",
            auth: Some(ConnectorAuth::Keyless),
            risk: Some(TermsRisk::CoreOk),
            free_tier: Some("No published limit."),
            attribution: Some("U.S. Geological Survey — public domain under 17 U.S.C. §105"),
            docs: Some("https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php"),
            note: None,
            provider_id: Some("usgs"),
        },
        Entry {
            id: "nws",
            name: "NOAA / National Weather Service",
            category: ConnectorCategory::Geospatial,
            stage: ConnectorStage::Wired,
            summary: "Active severe weather warnings.",
            auth: Some(ConnectorAuth::Keyless),
            risk: Some(TermsRisk::CoreOk),
            free_tier: Some(
                "\"Reasonable rate limits\", figures not published; a refused request may be \
                 retried after about five seconds. A User-Agent identifying the client is \
                 required.",
            ),
            attribution: Some("NOAA National Weather Service — public domain"),
            docs: Some("https://www.weather.gov/documentation/services-web-api"),
            note: Some(
                "United States only, and about half of active alerts carry no coordinates \
                 because they are scoped to named forecast zones. Both facts are on the layer.",
            ),
            provider_id: Some("nws"),
        },
        Entry {
            id: "opensky",
            name: "OpenSky Network",
            category: ConnectorCategory::Geospatial,
            stage: ConnectorStage::Wired,
            summary: "Live aircraft positions, filtered here to dedicated freight operators.",
            auth: Some(ConnectorAuth::Oauth),
            risk: Some(TermsRisk::RequiresWrittenAgreement),
            free_tier: Some(
                "400 credits/day anonymous, 4,000 authenticated. A global state request costs \
                 four. Basic auth was withdrawn on 18 March 2026; OAuth2 client credentials \
                 are the only supported flow.",
            ),
            attribution: Some("Flight data from the OpenSky Network"),
            docs: Some("https://openskynetwork.github.io/opensky-api/rest.html"),
            note: Some(
                "Ships switched off, and not because of the price. The licence covers non-profit \
                 research and education; using the REST API \"in any operational capacity — \
                 including integration into a live product, service, or automated system\" needs \
                 a prior written agreement. A shipped app polling on a timer is exactly that, so \
                 this needs your own arrangement with OpenSky. See ADR-040.",
            ),
            provider_id: Some("opensky"),
        },
    ]
}

/// Reviewed, and not wired. The reason is the whole value of the entry — without it the next
/// person re-does the research and reaches the same answer.
fn declined_entries() -> Vec<Entry> {
    use ConnectorCategory::{CryptoMarket, EquitiesMarket, Exchange, Geospatial, Macro};

    vec![
        declined(
            "binance",
            "Binance",
            Exchange,
            "Spot and futures market data from the largest crypto venue.",
            "Its public market-data endpoints are documented and keyless and would be a genuine \
             second crypto source. They have not been through the ADR-008 terms review, and the \
             service is geo-restricted in the United States with Binance.US a separate API under \
             separate terms. Adding it is one table entry; adding it unreviewed is the thing \
             ADR-008 forbids. See ADR-039.",
        ),
        declined(
            "aishub",
            "AISHub",
            Geospatial,
            "Aggregated AIS vessel positions from a cooperative receiver network.",
            "Access is earned by contributing a raw NMEA feed from an AIS receiver you operate — \
             at least ten vessels of coverage and 90% uptime over a rolling week. There is no \
             paid tier and no anonymous tier, so it can be neither a shipped source nor a \
             \"just add a key\" one: the thing you supply is a radio. See ADR-040.",
        ),
        declined(
            "marinetraffic",
            "MarineTraffic",
            Geospatial,
            "Commercial vessel tracking and port congestion.",
            "No free API tier exists. The endpoints its own website calls are undocumented and \
             not offered for third-party use, which is the case ADR-008 covers directly.",
        ),
        declined(
            "celestrak",
            "CelesTrak",
            Geospatial,
            "Satellite orbital elements.",
            "Considered for the maritime layer and rejected on grounds of category rather than \
             terms: it publishes satellites, not ships. Positions captioned as commercial \
             shipping would be miscategorised data dressed as supply-chain intelligence.",
        ),
        declined(
            "imf",
            "IMF Data",
            Macro,
            "Macroeconomic and financial statistics.",
            "Covers the same indicators as the World Bank. Its legacy SDMX JSON service was \
             retired on 5 November 2025, and the SDMX 3.0 replacement needs dataflow discovery \
             and key construction before a single figure comes back — for data the World Bank \
             returns from one URL. Revisit if World Bank coverage degrades.",
        ),
        declined(
            "eia",
            "U.S. Energy Information Administration",
            Macro,
            "Energy production, stocks, prices and infrastructure statistics.",
            "Free key, clean REST, and the right publisher — but what it serves is time series, \
             not geography. The energy geography Sentry needed from the EIA is eight chokepoint \
             transit volumes updated twice a year, and those ship as constants with their \
             reporting period attached. A series layer would be a chart, and Compare draws \
             charts already.",
        ),
        declined(
            "yahoo-finance",
            "Yahoo Finance (unofficial endpoints)",
            EquitiesMarket,
            "The endpoints Yahoo's own pages call for quotes and history.",
            "They work and they are widely used. They are not offered as a public API and have \
             no terms covering third-party use. ADR-008 treats that as a question about this \
             project's standing rather than a technical one.",
        ),
        declined(
            "equity-fear-greed",
            "The well-known equity Fear & Greed index",
            CryptoMarket,
            "A widely cited sentiment gauge for US equities.",
            "Its data endpoint is reachable and is what that site's own charts call, but it is \
             not offered as a public API and its terms do not cover third-party use. This is why \
             the equity sentiment index in Brew Terminal is computed from FRED inputs and \
             labelled as computed, rather than reported. See ADR-037.",
        ),
    ]
}

/// Named, categorised, and entirely unreviewed.
///
/// Everything here is a queue entry. No limits, no risk level, no auth type — because nobody
/// has read a word of any of their terms, and writing a plausible number beside a name is how a
/// catalogue starts lying.
fn candidates() -> Vec<Entry> {
    use ConnectorCategory::{
        CryptoMarket, Defi, EquitiesMarket, Exchange, Filings, Fx, Geospatial, Macro, News, Nft,
        OnchainAnalytics, Wallet,
    };

    vec![
        // --- Crypto market data aggregators ---
        candidate(
            "bravenewcoin",
            "Brave New Coin",
            CryptoMarket,
            "Crypto indices and market data.",
        ),
        candidate(
            "chainlink-feeds",
            "Chainlink Data Feeds",
            CryptoMarket,
            "On-chain price oracles.",
        ),
        candidate(
            "coinapi",
            "CoinAPI",
            CryptoMarket,
            "Consolidated market data across venues.",
        ),
        candidate(
            "coincap",
            "CoinCap",
            CryptoMarket,
            "Crypto prices and market caps.",
        ),
        candidate(
            "coinglass",
            "CoinGlass",
            CryptoMarket,
            "Derivatives open interest, funding and liquidations.",
        ),
        candidate(
            "coinlayer",
            "Coinlayer",
            CryptoMarket,
            "Crypto exchange rates.",
        ),
        candidate(
            "coinlore",
            "Coinlore",
            CryptoMarket,
            "Crypto prices and rankings.",
        ),
        candidate(
            "coinmarketcap",
            "CoinMarketCap",
            CryptoMarket,
            "Crypto prices, market caps and rankings.",
        ),
        candidate(
            "coinpaprika",
            "Coinpaprika",
            CryptoMarket,
            "Crypto prices, tickers and asset metadata.",
        ),
        candidate(
            "coinranking",
            "Coinranking",
            CryptoMarket,
            "Crypto prices and rankings.",
        ),
        candidate(
            "coinstats",
            "CoinStats",
            CryptoMarket,
            "Prices, plus wallet and DeFi position tracking.",
        ),
        candidate(
            "cryptocompare",
            "CryptoCompare",
            CryptoMarket,
            "Market data and crypto news.",
        ),
        candidate(
            "santiment",
            "Santiment",
            OnchainAnalytics,
            "On-chain, social and development activity metrics.",
        ),
        candidate(
            "sharpe",
            "Sharpe",
            CryptoMarket,
            "Crypto market and portfolio data.",
        ),
        // --- Venue APIs ---
        candidate("bitfinex", "Bitfinex", Exchange, "Venue market data."),
        candidate("bitget", "Bitget", Exchange, "Venue market data."),
        candidate("bitstamp", "Bitstamp", Exchange, "Venue market data."),
        candidate("bybit", "Bybit V5", Exchange, "Venue market data."),
        candidate(
            "coinbase",
            "Coinbase Advanced Trade",
            Exchange,
            "Venue market data.",
        ),
        candidate("coinex", "CoinEx", Exchange, "Venue market data."),
        candidate(
            "cryptocom",
            "Crypto.com Exchange",
            Exchange,
            "Venue market data.",
        ),
        candidate(
            "delta",
            "Delta Exchange",
            Exchange,
            "Derivatives venue market data.",
        ),
        candidate(
            "deribit",
            "Deribit",
            Exchange,
            "Options and futures market data.",
        ),
        candidate(
            "dydx",
            "dYdX",
            Exchange,
            "Decentralised perpetuals market data.",
        ),
        candidate("gateio", "Gate.io v4", Exchange, "Venue market data."),
        candidate("gemini", "Gemini", Exchange, "Venue market data."),
        candidate("kraken", "Kraken", Exchange, "Venue market data."),
        candidate("kucoin", "KuCoin", Exchange, "Venue market data."),
        candidate("mexc", "MEXC Spot", Exchange, "Venue market data."),
        candidate("okx", "OKX", Exchange, "Venue market data."),
        candidate("poloniex", "Poloniex", Exchange, "Venue market data."),
        candidate("whitebit", "WhiteBIT", Exchange, "Venue market data."),
        // --- Wallets and balances ---
        candidate(
            "alchemy",
            "Alchemy",
            Wallet,
            "Token balances, NFT holdings and node access.",
        ),
        candidate(
            "ankr",
            "Ankr Advanced API",
            Wallet,
            "Multi-chain balances and node access.",
        ),
        candidate(
            "blockchair",
            "Blockchair",
            Wallet,
            "Multi-chain explorer data.",
        ),
        candidate(
            "blockcypher",
            "BlockCypher",
            Wallet,
            "Blockchain explorer and address data.",
        ),
        candidate(
            "covalent",
            "Covalent",
            Wallet,
            "Unified multi-chain balances and transfers.",
        ),
        candidate(
            "debank",
            "DeBank Open API",
            Wallet,
            "DeFi portfolio positions by address.",
        ),
        candidate(
            "ethplorer",
            "Ethplorer",
            Wallet,
            "Ethereum token balances and transfers.",
        ),
        candidate(
            "helius",
            "Helius DAS API",
            Wallet,
            "Solana assets and transaction history.",
        ),
        candidate(
            "mempool",
            "Mempool.space",
            Wallet,
            "Bitcoin mempool, fees and address data.",
        ),
        candidate(
            "moralis",
            "Moralis",
            Wallet,
            "Multi-chain wallet and NFT data.",
        ),
        candidate(
            "oklink",
            "OKLink Explorer API",
            Wallet,
            "Multi-chain explorer data.",
        ),
        candidate(
            "solscan",
            "Solscan Pro API",
            Wallet,
            "Solana explorer data.",
        ),
        // --- DeFi and NFT ---
        candidate(
            "zeroex",
            "0x API",
            Defi,
            "DEX liquidity aggregation and quotes.",
        ),
        candidate(
            "oneinch",
            "1inch API",
            Defi,
            "DEX aggregation and swap routing.",
        ),
        candidate(
            "bitquery",
            "Bitquery",
            OnchainAnalytics,
            "On-chain queries across many chains.",
        ),
        candidate(
            "defillama",
            "DefiLlama",
            Defi,
            "Protocol TVL, yields and stablecoin supply.",
        ),
        candidate(
            "dexscreener",
            "DEX Screener",
            Defi,
            "DEX pair prices and liquidity.",
        ),
        candidate(
            "lifi",
            "LI.FI API",
            Defi,
            "Cross-chain bridge and swap routing.",
        ),
        candidate(
            "paraswap",
            "ParaSwap",
            Defi,
            "DEX aggregation and swap routing.",
        ),
        candidate(
            "magiceden",
            "Magic Eden",
            Nft,
            "NFT marketplace listings and sales.",
        ),
        candidate("nftscan", "NFTScan", Nft, "Multi-chain NFT data."),
        candidate(
            "opensea",
            "OpenSea",
            Nft,
            "NFT collections, listings and sales.",
        ),
        candidate("rarible", "Rarible", Nft, "NFT marketplace data."),
        candidate("reservoir", "Reservoir", Nft, "Aggregated NFT market data."),
        candidate(
            "simplehash",
            "SimpleHash",
            Nft,
            "Multi-chain NFT and token metadata.",
        ),
        // --- On-chain analytics and crypto research ---
        candidate(
            "coinmetrics",
            "Coin Metrics Community API",
            OnchainAnalytics,
            "Network and market metrics.",
        ),
        candidate(
            "dune",
            "Dune API",
            OnchainAnalytics,
            "Results of community SQL queries over chain data.",
        ),
        candidate(
            "flipside",
            "Flipside API",
            OnchainAnalytics,
            "Curated on-chain datasets and queries.",
        ),
        candidate(
            "glassnode",
            "Glassnode",
            OnchainAnalytics,
            "On-chain and market indicators.",
        ),
        candidate(
            "lunarcrush",
            "LunarCrush",
            OnchainAnalytics,
            "Social activity metrics for crypto assets.",
        ),
        candidate(
            "messari",
            "Messari",
            OnchainAnalytics,
            "Asset profiles, metrics and research.",
        ),
        candidate("coindar", "Coindar", News, "Crypto project event calendar."),
        candidate(
            "coinmarketcal",
            "CoinMarketCal",
            News,
            "Community-submitted crypto event calendar.",
        ),
        candidate(
            "cryptopanic",
            "CryptoPanic",
            News,
            "Aggregated crypto news and sentiment votes.",
        ),
        // --- Equities and multi-asset ---
        candidate(
            "marketstack",
            "Marketstack",
            EquitiesMarket,
            "End-of-day and intraday equity prices.",
        ),
        candidate(
            "twelvedata",
            "Twelve Data",
            EquitiesMarket,
            "Multi-asset prices, fundamentals and indicators.",
        ),
        candidate(
            "polygon",
            "Polygon.io",
            EquitiesMarket,
            "US equities, options and crypto market data.",
        ),
        candidate(
            "stockdata",
            "StockData.org",
            EquitiesMarket,
            "Equity prices and news.",
        ),
        candidate(
            "eodhd",
            "EOD Historical Data",
            EquitiesMarket,
            "Global end-of-day prices and fundamentals.",
        ),
        candidate(
            "fmp",
            "Financial Modeling Prep",
            EquitiesMarket,
            "Fundamentals, statements and ratios.",
        ),
        candidate(
            "iexcloud",
            "IEX Cloud",
            EquitiesMarket,
            "US equity market data.",
        ),
        candidate_noted(
            "alpaca",
            "Alpaca",
            EquitiesMarket,
            "Market data, alongside a brokerage the app would not use.",
            "A broker API. Brew Terminal places no orders and offers no brokerage — only the \
             market-data endpoints could ever be a candidate, and a review would have to \
             establish that they are usable without the trading surface.",
        ),
        candidate_noted(
            "tradier",
            "Tradier",
            EquitiesMarket,
            "Market data, alongside a brokerage the app would not use.",
            "Same position as Alpaca: broker API, market data only, and a review would have to \
             separate the two.",
        ),
        // --- Macro and FX ---
        candidate(
            "econdb",
            "Econdb",
            Macro,
            "Macroeconomic series across many countries.",
        ),
        candidate_noted(
            "fred-json",
            "FRED JSON API",
            Macro,
            "The keyed JSON form of the FRED series this app already reads.",
            "The CSV endpoint is already wired and needs no key. This would only be worth \
             reviewing for endpoints the CSV form cannot serve — release calendars, vintages, \
             series search.",
        ),
        candidate(
            "worldbank-data360",
            "World Bank Data360",
            Macro,
            "Indicator metadata and a wider catalogue than the classic API.",
        ),
        candidate(
            "exchangerate-host",
            "Exchangerate.host",
            Fx,
            "Exchange rates and conversion.",
        ),
        candidate(
            "currencylayer",
            "Currencylayer",
            Fx,
            "Exchange rates and conversion.",
        ),
        candidate(
            "exchangerate-dev",
            "Exchangerate.dev",
            Fx,
            "Exchange rates and conversion.",
        ),
        candidate(
            "goldprice-dev",
            "Goldprice.dev",
            Fx,
            "Precious metal spot prices.",
        ),
        // --- Filings and disclosure ---
        candidate_noted(
            "sec-edgar",
            "SEC EDGAR",
            Filings,
            "Company filings, submissions history and XBRL company facts.",
            "The strongest candidate in this list: US government output, documented, keyless, \
             and the primary source for anything a filings feature would show. The published \
             fair-access policy sets a request ceiling and requires a declared User-Agent, both \
             of which a review would need to record.",
        ),
        candidate(
            "congressinvests",
            "CongressInvests",
            Filings,
            "US congressional stock transaction disclosures.",
        ),
        candidate(
            "edgrapi",
            "Edgrapi",
            Filings,
            "A parsed view over SEC filings.",
        ),
        candidate(
            "filingrail",
            "Filingrail",
            Filings,
            "Filing alerts and parsed disclosures.",
        ),
        // --- News and events ---
        candidate(
            "marketaux",
            "Marketaux",
            News,
            "Financial news with entity tagging.",
        ),
        candidate(
            "benzinga",
            "Benzinga Basic News",
            News,
            "Financial news headlines.",
        ),
        candidate(
            "lambda-finance-news",
            "Lambda Finance News API",
            News,
            "Aggregated financial news.",
        ),
        candidate_noted(
            "gdelt",
            "GDELT",
            Geospatial,
            "Global news volume and tone, by country and theme, from DOC 2.0 and the summary API.",
            "The one candidate that would extend Sentry rather than duplicate an existing \
             source. Tone is a computed measure, so a review would have to settle how it is \
             labelled on screen before any of it is drawn — ADR-022 applies.",
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn ids_are_unique_and_url_safe() {
        let mut seen = HashSet::new();
        for entry in entries() {
            assert!(seen.insert(entry.id), "duplicate id {}", entry.id);
            assert!(
                entry
                    .id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
                "{} is not a stable lowercase id",
                entry.id
            );
            assert!(!entry.name.is_empty());
            assert!(!entry.summary.is_empty(), "{} has no summary", entry.id);
        }
    }

    /// The rule this file exists to keep, enforced rather than merely written down.
    ///
    /// A candidate with a rate limit or a risk level beside it is a review that never happened,
    /// presented in the most convincing format available.
    #[test]
    fn a_candidate_carries_no_claim_about_anyones_terms() {
        for entry in entries() {
            if entry.stage != ConnectorStage::Candidate {
                continue;
            }
            assert!(entry.risk.is_none(), "{} claims a risk level", entry.id);
            assert!(
                entry.free_tier.is_none(),
                "{} claims a rate limit",
                entry.id
            );
            assert!(entry.auth.is_none(), "{} claims an auth type", entry.id);
            assert!(
                entry.attribution.is_none(),
                "{} claims an attribution requirement",
                entry.id
            );
            assert!(
                entry.provider_id.is_none(),
                "{} claims an adapter",
                entry.id
            );
        }
    }

    /// And the converse: a wired connector has been through the review, so it must carry what
    /// the review produced.
    #[test]
    fn a_wired_connector_carries_the_result_of_its_review() {
        let wired: Vec<Entry> = entries()
            .into_iter()
            .filter(|e| e.stage == ConnectorStage::Wired)
            .collect();

        assert_eq!(wired.len(), 11, "the wired count changed without this test");

        for entry in wired {
            assert!(entry.risk.is_some(), "{} has no risk level", entry.id);
            assert!(
                entry.free_tier.is_some(),
                "{} has no limits recorded",
                entry.id
            );
            assert!(entry.auth.is_some(), "{} has no auth type", entry.id);
            assert!(
                entry.provider_id.is_some(),
                "{} is wired but names no provider id, so no envelope can link back to it",
                entry.id
            );
        }
    }

    /// A decline without a reason is worse than no entry: the next person re-does the research
    /// and reaches the same answer.
    #[test]
    fn every_decline_says_why() {
        for entry in entries()
            .iter()
            .filter(|e| e.stage == ConnectorStage::Declined)
        {
            let note = entry
                .note
                .expect("a declined connector must carry its reason");
            assert!(
                note.len() > 60,
                "{} has a reason too short to be one",
                entry.id
            );
        }
    }

    /// Every wired connector's `provider_id` has to resolve, or the catalogue cannot answer
    /// "where did this number come from" for the envelope that carries it.
    #[test]
    fn wired_provider_ids_match_the_adapters_that_exist() {
        use crate::providers::live::{
            alphavantage::ALPHAVANTAGE_ID, alternative_me::FNG_ID, coingecko::COINGECKO_ID,
            finnhub::FINNHUB_ID, frankfurter::FRANKFURTER_ID, fred::FRED_ID, nws::NWS_ID,
            opensky::OPENSKY_ID, rss::RSS_PROVIDER_ID, usgs::USGS_ID, worldbank::WORLDBANK_ID,
        };

        let known: HashSet<&str> = [
            COINGECKO_ID,
            FINNHUB_ID,
            ALPHAVANTAGE_ID,
            FRED_ID,
            FNG_ID,
            RSS_PROVIDER_ID,
            WORLDBANK_ID,
            FRANKFURTER_ID,
            USGS_ID,
            NWS_ID,
            OPENSKY_ID,
        ]
        .into_iter()
        .collect();

        for entry in entries()
            .iter()
            .filter(|e| e.stage == ConnectorStage::Wired)
        {
            let id = entry.provider_id.expect("checked above");
            assert!(
                known.contains(id),
                "{} points at provider id {id:?}, which no adapter uses",
                entry.id
            );
        }
    }

    #[test]
    fn the_catalogue_is_worth_having() {
        let all = entries();
        assert!(all.len() > 90, "only {} entries", all.len());
        assert!(all.iter().any(|e| e.stage == ConnectorStage::Declined));
        assert!(all.iter().any(|e| e.stage == ConnectorStage::Candidate));
    }
}
