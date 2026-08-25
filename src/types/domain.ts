/**
 * App-level domain models.
 *
 * These mirror the Rust structs in `src-tauri/src/models/`, which are the source of truth.
 * `ts-rs` will generate the canonical declarations into `src/types/generated/` and CI will
 * fail on drift; this file is the hand-written contract used until that generation is wired in.
 *
 * Convention: fields that Rust models as `Option<T>` are typed `T | null`, never `T?`.
 * `exactOptionalPropertyTypes` is on, and serde emits `null` rather than omitting the key —
 * so `| null` describes what actually crosses the wire.
 */

export type AssetType = 'crypto' | 'stock' | 'etf' | 'index';

export type ChartRange = '1D' | '1W' | '1M' | '3M' | '1Y' | 'MAX';

export type Theme = 'dark' | 'light' | 'soft';

export type MotionPreference = 'system' | 'always' | 'never';

export interface Asset {
  /** Canonical id, provider-independent: `crypto:cg:bitcoin`, `stock:us:AAPL`. */
  id: string;
  assetType: AssetType;
  symbol: string;
  name: string;
  currency: string;
  exchange: string | null;
  region: string | null;
}

export interface Quote {
  assetId: string;
  symbol: string;
  name: string;
  assetType: AssetType;
  price: number;
  currency: string;
  changePct24h: number | null;
  changePct7d: number | null;
  marketCap: number | null;
  volume24h: number | null;
  /** Downsampled to at most 24 points at the adapter boundary — see ADR-006. */
  sparkline: number[];
}

export interface ChartPoint {
  /** Unix epoch seconds, UTC. */
  time: number;
  close: number;
}

export type NewsCategory = 'crypto' | 'stocks' | 'macro' | 'other';

export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  sourceName: string;
  category: NewsCategory;
  /** Unix epoch seconds, UTC. Null when the provider gives no date — we do not invent one. */
  publishedAt: number | null;
}

export interface NewsFilter {
  category: NewsCategory | 'all';
  assetId: string | null;
  limit: number;
}

/**
 * A locally stored research note.
 *
 * Notes never leave the device on their own — they are excluded from provider requests, and
 * attaching one to a model prompt takes a separate, explicit action.
 */
export interface Note {
  id: string;
  /** Null for a general note not tied to an asset. */
  assetId: string | null;
  title: string;
  /** Markdown source, rendered as plain text for now — see DEPENDENCIES.md. */
  bodyMd: string;
  createdAt: number;
  updatedAt: number;
}

export type ProgressStatus = 'not-started' | 'in-progress' | 'completed';

/**
 * Progress against a single lesson.
 *
 * Local, and carrying no score, streak or comparison to anyone else — it exists so a reader
 * can find their place again, not to gamify reading.
 */
export interface LearningProgress {
  itemId: string;
  pathId: string;
  status: ProgressStatus;
  completedAt: number | null;
  updatedAt: number;
}

export interface Watchlist {
  id: string;
  name: string;
  position: number;
  isDefault: boolean;
}

export interface WatchlistItem {
  watchlistId: string;
  assetId: string;
  position: number;
  addedAt: number;
}

export interface AssetSearchResult {
  asset: Asset;
  /** 0..1. Ranking only — never presented to the user as a quality judgement. */
  score: number;
}

export type ProviderKind = 'market' | 'news' | 'community' | 'ai';

/**
 * A market region a provider can serve.
 *
 * Not a union type: the set of regions is provider-driven and grows as adapters are added, so
 * a closed union here would mean a code change for every new market.
 */
export interface Region {
  id: string;
  displayName: string;
  /** What choosing this region actually changes, in plain language. */
  description: string;
}

export type ProviderHealth = 'ok' | 'not-configured' | 'rate-limited' | 'error' | 'disabled';

export interface ProviderInfo {
  id: string;
  displayName: string;
  kind: ProviderKind;
  enabled: boolean;
  requiresCredential: boolean;
  hasCredential: boolean;
  health: ProviderHealth;
  /** Attribution text the UI is required to render alongside this provider's data. */
  attribution: string;
  docsUrl: string | null;
  supportedAssetTypes: AssetType[];
  supportedRanges: ChartRange[];
  supportedRegions: Region[];
}

export interface Preferences {
  theme: Theme;
  region: string;
  displayCurrency: string;
  refreshIntervalSecs: number;
  refreshWhenUnfocused: boolean;
  reducedMotion: MotionPreference;
  communityEnabled: boolean;
  aiEnabled: boolean;
  /** Which configured AI provider is active. Both can be set up; one is used. */
  aiMode: AiMode;
  navRailExpanded: boolean;
  onboardingCompleted: boolean;
}

export interface CacheStats {
  entryCount: number;
  totalBytes: number;
  oldestFetchedAt: number | null;
}

export interface AppInfo {
  version: string;
  /** Shown on the Privacy page so the user can find their own data. */
  dataDir: string;
  dbPath: string;
  schemaVersion: number;
  isMockMode: boolean;
}

// --- Model Desk ---------------------------------------------------------------------------

export type AiMode = 'local' | 'cloud';

/**
 * Where the configured endpoint resolved to. `loopback` is the only value that earns the
 * "offline" label, and Rust decides it by resolving the host rather than reading the URL.
 * See AI_POLICY.md §1.
 */
export type EndpointReach = 'loopback' | 'network';

export type ChatRole = 'system' | 'user' | 'assistant';

/** What is stored about one of the two configurable providers. */
export interface AiProviderSummary {
  configured: boolean;
  endpoint: string | null;
  model: string | null;
  /** A flag, never a key. See THREAT_MODEL.md §4. */
  hasCredential: boolean;
}

/**
 * The top-level fields describe the **active** provider; `local` and `cloud` carry both, so
 * switching modes does not discard the other one's configuration.
 */
export interface AiStatus {
  configured: boolean;
  /** The `aiEnabled` preference. Configured-but-off is a real state. */
  enabled: boolean;
  mode: AiMode;
  endpoint: string | null;
  model: string | null;
  reach: EndpointReach | null;
  /** Rendered by Rust so the wording in AI_POLICY.md §1 has exactly one source. */
  reachLabel: string | null;
  leavesDevice: boolean;
  /** True for cloud: the request carries a key, so it cannot run without one. */
  requiresCredential: boolean;
  hasCredential: boolean;
  systemPromptVersion: string;
  local: AiProviderSummary;
  cloud: AiProviderSummary;
}

export interface AiConversation {
  id: string;
  title: string;
  providerId: string;
  mode: AiMode;
  modelName: string | null;
  systemPromptVersion: string;
  createdAt: number;
  updatedAt: number;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

/** One piece of quoted material the user chose to attach. */
export interface AiContextItem {
  kind: string;
  label: string;
  text: string;
}

/**
 * A row of the transparency log: that a send happened, to whom, and how large.
 * `includedContext` is a JSON array of `{kind, label}` — never the text, never the prompt.
 */
export interface AiOutboundEntry {
  id: string;
  providerId: string;
  mode: string;
  conversationId: string | null;
  charCount: number;
  includedContext: string;
  createdAt: number;
}

export interface AiSendResult {
  conversationId: string;
  userMessage: AiMessage;
  assistantMessage: AiMessage;
}

/**
 * What a send would transmit, computed in Rust from the same assembly the send uses — so the
 * count shown in the consent panel is the count of what actually goes out. AI_POLICY.md §2.2.
 */
export interface AiSendPreview {
  charCount: number;
  systemPromptChars: number;
  historyChars: number;
  promptChars: number;
  contextChars: number;
  contextLabels: string[];
  leavesDevice: boolean;
  reachLabel: string | null;
}

// --- Encrypted profile --------------------------------------------------------------------

/** How an import treats what is already on this machine. */
export type ImportMode = 'merge' | 'replace';

/**
 * What a `.brewprofile` contains, computed by decrypting and validating it — without writing
 * anything. The user chooses merge or replace while looking at these. See DATA_MODEL.md §6.
 */
export interface ProfileSummary {
  schemaVersion: number;
  appVersion: string;
  exportedAt: number;
  watchlists: number;
  watchlistItems: number;
  notes: number;
  progress: number;
  bookmarks: number;
  preferences: number;
  providers: number;
  assets: number;
}

export interface ImportResult {
  mode: ImportMode;
  summary: ProfileSummary;
  /** Where the pre-import backup of the database was written. */
  backupPath: string;
}

export interface ExportResult {
  path: string;
  bytes: number;
}

// --- Community -----------------------------------------------------------------------------

/**
 * One post from a public discussion platform.
 *
 * Quoted material, not a signal. `score` and `commentCount` are the platform's own numbers,
 * reported and never interpreted — there is deliberately no sentiment, ranking or trend field.
 * See PRODUCT_SCOPE_V0_1.md §6.
 */
export interface CommunityPost {
  id: string;
  title: string;
  url: string;
  author: string | null;
  /** Where it was posted, in that platform's own words. */
  community: string | null;
  score: number | null;
  commentCount: number | null;
  postedAt: number | null;
  sourceName: string;
}

export interface CommunityFilter {
  assetId: string | null;
  limit: number;
}
