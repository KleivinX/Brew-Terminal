/**
 * App-level domain models.
 *
 * **These are generated.** The Rust structs in `src-tauri/src/models/` are the source of truth;
 * `ts-rs` exports them into `./generated/` and the export runs as part of `cargo test`, so a
 * Rust type that changes without its TypeScript counterpart being regenerated fails the Rust
 * suite. That closes ADR-010, which had been outstanding since Phase 0.
 *
 * Two things are worth knowing before editing anything here:
 *
 * 1. **Integers are annotated in Rust, not inferred.** `ts-rs` maps `i64` to `bigint`, which is
 *    wrong for this transport: `serde_json` writes an `i64` as a JSON number and Tauri hands the
 *    frontend a `number`. Every integer field therefore carries an explicit
 *    `#[cfg_attr(test, ts(type = "number"))]` — or `"number | null"` where it is `Option`,
 *    because the override replaces the whole type including the `Option` wrapper.
 * 2. **Nothing in `./generated/` should be edited.** Change the Rust struct and re-run
 *    `cargo test`.
 *
 * What stays hand-written below is only what has no Rust counterpart to generate from.
 */

// --- Generated from the Rust models ---

export type { AiContextItem } from './generated/AiContextItem';
export type { AiConversation } from './generated/AiConversation';
export type { AiMessage } from './generated/AiMessage';
export type { AiMode } from './generated/AiMode';
export type { AiOutboundEntry } from './generated/AiOutboundEntry';
export type { AiProviderSummary } from './generated/AiProviderSummary';
export type { AiSendPreview } from './generated/AiSendPreview';
export type { AiSendResult } from './generated/AiSendResult';
export type { AiStatus } from './generated/AiStatus';
export type { AppInfo } from './generated/AppInfo';
export type { Asset } from './generated/Asset';
export type { AssetSearchResult } from './generated/AssetSearchResult';
export type { AssetType } from './generated/AssetType';
export type { CacheStats } from './generated/CacheStats';
export type { ChartPoint } from './generated/ChartPoint';
export type { ChartRange } from './generated/ChartRange';
export type { ChatRole } from './generated/ChatRole';
export type { CommunityFilter } from './generated/CommunityFilter';
export type { CommunityPost } from './generated/CommunityPost';
export type { DownloadProgress } from './generated/DownloadProgress';
export type { EndpointReach } from './generated/EndpointReach';
export type { EngineStatus } from './generated/EngineStatus';
export type { ExportResult } from './generated/ExportResult';
export type { FeedPreview } from './generated/FeedPreview';
export type { ImportMode } from './generated/ImportMode';
export type { ImportResult } from './generated/ImportResult';
export type { LearningProgress } from './generated/LearningProgress';
export type { LocalModelOverview } from './generated/LocalModelOverview';
export type { ModelEntry } from './generated/ModelEntry';
export type { ModelStatus } from './generated/ModelStatus';
export type { NewsArticle } from './generated/NewsArticle';
export type { NewsCategory } from './generated/NewsCategory';
export type { NewsFeed } from './generated/NewsFeed';
export type { NewsFilter } from './generated/NewsFilter';
export type { Note } from './generated/Note';
export type { Preferences } from './generated/Preferences';
export type { ProfileSummary } from './generated/ProfileSummary';
export type { ProgressStatus } from './generated/ProgressStatus';
export type { ProviderHealth } from './generated/ProviderHealth';
export type { ProviderInfo } from './generated/ProviderInfo';
export type { ProviderKind } from './generated/ProviderKind';
export type { Quote } from './generated/Quote';
export type { Region } from './generated/Region';
export type { UpdateCheck } from './generated/UpdateCheck';
export type { Watchlist } from './generated/Watchlist';
export type { WatchlistItem } from './generated/WatchlistItem';

export type { CostBasisMethod } from './generated/CostBasisMethod';

export type { PortfolioSummary } from './generated/PortfolioSummary';

export type { Position } from './generated/Position';

export type { Transaction } from './generated/Transaction';

export type { TransactionKind } from './generated/TransactionKind';

export type { ScreenerFilter } from './generated/ScreenerFilter';

export type { ScreenerSort } from './generated/ScreenerSort';

export type { Range } from './generated/Range';

export type { Alert } from './generated/Alert';

export type { AlertKind } from './generated/AlertKind';

export type { TriggeredAlert } from './generated/TriggeredAlert';

export type { MacroSeries } from './generated/MacroSeries';

export type { MultiSeries } from './generated/MultiSeries';

export type { AssetSeries } from './generated/AssetSeries';

// --- Frontend narrowings ---

/**
 * `Preferences.theme` and `Preferences.reducedMotion` are `String` in Rust, because the
 * preferences table stores them as text and the database is not the place to enforce a UI
 * enum. The frontend is where the set is actually closed, so these two live here.
 */
export type Theme = 'dark' | 'light' | 'soft';

export type MotionPreference = 'system' | 'always' | 'never';

// --- Names the UI uses ---

/**
 * Aliases for two generated types whose Rust names are scoped by their module (`localai`) and
 * read as too generic on their own once they cross into the frontend.
 */
export type { ModelStatus as LocalModel } from './generated/ModelStatus';
export type { EngineStatus as LocalEngineStatus } from './generated/EngineStatus';
