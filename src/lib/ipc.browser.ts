import communityFixture from '@content/fixtures/community.json';
import cryptoQuotes from '@content/fixtures/crypto_quotes.json';
import stockQuotes from '@content/fixtures/stock_quotes.json';
import searchIndex from '@content/fixtures/search_index.json';
import newsFixture from '@content/fixtures/news.json';
import chartFixture from '@content/fixtures/chart_series.json';
import type {
  AiContextItem,
  AiConversation,
  AiMessage,
  AiOutboundEntry,
  AiStatus,
  Asset,
  AssetSearchResult,
  ChartPoint,
  ChartRange,
  Alert,
  CommunityPost,
  LocalModelOverview,
  PortfolioSummary,
  Position,
  Transaction,
  NewsArticle,
  NewsCategory,
  NewsFeed,
  LearningProgress,
  Note,
  Preferences,
  ProfileSummary,
  ProviderInfo,
  Quote,
  ScreenerFilter,
  SentimentIndex,
  TriggeredAlert,
  Watchlist,
  WatchlistItem,
} from '@/types/domain';
import type { Envelope, EnvelopeMeta } from '@/types/envelope';
import type { MockBehavior } from './ipc';
import { scoreMatch } from './fuzzy';

/**
 * Browser harness.
 *
 * Serves the same fixture files the Rust mock provider reads via `include_str!`, so there is
 * exactly one copy of the development data. This exists because (a) `npm run dev` in a browser
 * is a far faster loop than a Tauri rebuild on a 2016 Intel machine, and (b) there is no macOS
 * WebDriver for Tauri, so a mocked-invoke harness carries real test coverage there.
 *
 * It is NOT a second implementation of the app's logic — it is a fixture server. Anything with
 * actual business logic belongs in Rust.
 */

const PROVIDER_ID = 'mock';
const PROVIDER_NAME = 'Mock provider (fixtures)';

let mockBehavior: MockBehavior = 'normal';

/** Provider state for the harness. The real app keeps this in SQLite plus the OS keychain. */
const providerState: Record<string, { enabled: boolean; hasCredential: boolean }> = {
  coingecko: { enabled: true, hasCredential: false },
  finnhub: { enabled: false, hasCredential: false },
  mock: { enabled: true, hasCredential: false },
  // Enabled here so the opt-in preference is the only gate in the harness. In the real app the
  // provider is seeded disabled too; the preference is what the UI actually toggles.
  'mock-community': { enabled: true, hasCredential: false },
};

const GLOBAL_REGION = {
  id: 'global',
  displayName: 'Global',
  description: 'Widely recognised assets across markets. No endorsement implied.',
};
const US_REGION = {
  id: 'us',
  displayName: 'United States',
  description: 'US-listed equities and ETFs.',
};

function harnessProviders(): ProviderInfo[] {
  const health = (id: string, requiresCredential: boolean): ProviderInfo['health'] => {
    const state = providerState[id];
    if (!state?.enabled) return 'disabled';
    if (requiresCredential && !state.hasCredential) return 'not-configured';
    return 'ok';
  };

  return [
    {
      id: 'coingecko',
      displayName: 'CoinGecko',
      kind: 'market',
      enabled: providerState.coingecko?.enabled ?? false,
      requiresCredential: false,
      hasCredential: providerState.coingecko?.hasCredential ?? false,
      health: health('coingecko', false),
      attribution: 'Data provided by CoinGecko',
      docsUrl: 'https://www.coingecko.com/en/api',
      supportedAssetTypes: ['crypto'],
      supportedRanges: [],
      supportedRegions: [GLOBAL_REGION],
    },
    {
      id: 'finnhub',
      displayName: 'Finnhub',
      kind: 'market',
      enabled: providerState.finnhub?.enabled ?? false,
      requiresCredential: true,
      hasCredential: providerState.finnhub?.hasCredential ?? false,
      health: health('finnhub', true),
      attribution: 'Market data by Finnhub',
      docsUrl: 'https://finnhub.io/docs/api',
      supportedAssetTypes: ['stock'],
      supportedRanges: [],
      supportedRegions: [US_REGION],
    },
    {
      id: PROVIDER_ID,
      displayName: PROVIDER_NAME,
      kind: 'market',
      enabled: providerState.mock?.enabled ?? false,
      requiresCredential: false,
      hasCredential: false,
      health: health(PROVIDER_ID, false),
      attribution: 'Development fixtures. Not real market data.',
      docsUrl: null,
      supportedAssetTypes: ['crypto', 'stock', 'etf'],
      supportedRanges: ['1D', '1W', '1M', '3M', '1Y', 'MAX'],
      supportedRegions: [GLOBAL_REGION, US_REGION],
    },
  ];
}

/**
 * Per-command invocation counts.
 *
 * A test seam, not app state. It exists so a test can assert that rendering N rows issues one
 * batched `get_quotes` rather than N single fetches — a regression that would be invisible in
 * a rendered snapshot but would quietly exhaust a provider's request budget.
 */
const callCounts = new Map<string, number>();

export function __harnessCallCount(command: string): number {
  return callCounts.get(command) ?? 0;
}

// Durable-enough state for a browser session. Real persistence is SQLite in Rust.
const STORAGE_KEY = 'brew.harness.state';

interface HarnessState {
  preferences: Preferences;
  watchlists: Watchlist[];
  items: WatchlistItem[];
  notes: Note[];
  progress: LearningProgress[];
}

const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  region: 'global',
  displayCurrency: 'USD',
  refreshIntervalSecs: 60,
  refreshWhenUnfocused: true,
  reducedMotion: 'system',
  communityEnabled: false,
  aiEnabled: false,
  aiMode: 'local',
  costBasisMethod: 'fifo',
  alertsEnabled: false,
  navRailExpanded: false,
  onboardingCompleted: false,
};

function defaultState(): HarnessState {
  return {
    preferences: { ...DEFAULT_PREFERENCES },
    watchlists: [{ id: 'wl-default', name: 'My watchlist', position: 0, isDefault: true }],
    items: [
      { watchlistId: 'wl-default', assetId: 'crypto:cg:bitcoin', position: 0, addedAt: 0 },
      { watchlistId: 'wl-default', assetId: 'crypto:cg:ethereum', position: 1, addedAt: 0 },
      { watchlistId: 'wl-default', assetId: 'stock:us:AAPL', position: 2, addedAt: 0 },
    ],
    notes: [],
    progress: [],
  };
}

function loadState(): HarnessState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<HarnessState>;
    const base = defaultState();
    return {
      preferences: { ...base.preferences, ...parsed.preferences },
      watchlists: parsed.watchlists ?? base.watchlists,
      items: parsed.items ?? base.items,
      notes: parsed.notes ?? base.notes,
      progress: parsed.progress ?? base.progress,
    };
  } catch {
    return defaultState();
  }
}

function saveState(state: HarnessState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Private browsing or a full quota — the session still works, it just will not persist. */
  }
}

let state = loadState();

/**
 * Feed list for the browser harness, mirroring `rss::DEFAULT_FEEDS` in Rust.
 *
 * The harness never fetches a real feed — `get_news` still answers from fixtures. What this
 * models is the *management* surface: adding, removing, enabling and the fact that removing a
 * default sticks.
 */
function defaultFeeds(): NewsFeed[] {
  const seeded: Array<[string, string, NewsCategory]> = [
    ['CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss', 'crypto'],
    ['Cointelegraph', 'https://cointelegraph.com/rss', 'crypto'],
    ['SEC press releases', 'https://www.sec.gov/news/pressreleases.rss', 'stocks'],
    [
      'Federal Reserve press releases',
      'https://www.federalreserve.gov/feeds/press_all.xml',
      'macro',
    ],
  ];
  return seeded.map(([title, url, category], index) => ({
    id: `feed-${index}`,
    title,
    url,
    category,
    enabled: true,
    isDefault: true,
    addedAt: 1_756_000_000,
    lastOkAt: 1_756_000_000,
    lastError: null,
  }));
}

function defaultLocalModels(): LocalModelOverview {
  return {
    models: [
      {
        id: 'qwen2.5-0.5b-instruct-q4km',
        name: 'Qwen2.5 0.5B Instruct',
        description: 'The smallest option. Fast on any machine.',
        parameters: '0.5B',
        quantisation: 'Q4_K_M',
        sizeBytes: 491_400_032,
        approxRamMb: 1200,
        licence: 'Apache-2.0',
        publisher: 'Qwen',
        sourceUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF',
        installed: false,
        partialBytes: 0,
      },
      {
        id: 'llama-3.2-1b-instruct-q4km',
        name: 'Llama 3.2 1B Instruct',
        description: 'A good default.',
        parameters: '1B',
        quantisation: 'Q4_K_M',
        sizeBytes: 807_694_464,
        approxRamMb: 1800,
        licence: 'Llama 3.2 Community License',
        publisher: 'Meta, packaged by bartowski',
        sourceUrl: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF',
        installed: false,
        partialBytes: 0,
      },
    ],
    engine: {
      installed: false,
      running: false,
      loadedModel: null,
      endpoint: 'http://127.0.0.1:11821/v1',
      build: 'b10687',
      project: 'llama.cpp',
      licence: 'MIT',
      sourceUrl: 'https://github.com/ggml-org/llama.cpp',
    },
    diskUsedBytes: 0,
    supported: true,
  };
}

/**
 * The harness downloads nothing. It models the *state machine* — install the engine, download a
 * model, start it, stop it — so the UI can be built and tested without a gigabyte of traffic.
 */
let localModels: LocalModelOverview = defaultLocalModels();

/**
 * Portfolio state for the harness.
 *
 * The replay maths lives in Rust and is tested there; what this models is the shape the UI
 * consumes, so positions and totals here are computed with a deliberately simple average-cost
 * pass rather than a second copy of the FIFO engine.
 */
let harnessAlerts: Alert[] = [];
let alertSeq = 0;

let portfolioTx: Transaction[] = [];
let txSeq = 0;

function harnessPortfolio(): PortfolioSummary {
  const byAsset = new Map<string, Transaction[]>();
  for (const t of portfolioTx) {
    byAsset.set(t.assetId, [...(byAsset.get(t.assetId) ?? []), t]);
  }

  const positions: Position[] = [];
  for (const [assetId, txs] of byAsset) {
    let quantity = 0;
    let cost = 0;
    let realised = 0;
    let fees = 0;
    let oversold = false;

    for (const t of [...txs].sort((a, b) => a.executedAt - b.executedAt)) {
      fees += t.fee;
      if (t.kind === 'buy') {
        cost += t.quantity * t.unitPrice + t.fee;
        quantity += t.quantity;
      } else {
        if (t.quantity > quantity + 1e-9) oversold = true;
        const sellable = Math.min(t.quantity, Math.max(quantity, 0));
        const average = quantity > 0 ? cost / quantity : 0;
        realised += sellable * t.unitPrice - t.fee - average * sellable;
        cost -= average * sellable;
        quantity -= sellable;
      }
      if (Math.abs(quantity) < 1e-9) {
        quantity = 0;
        cost = 0;
      }
    }

    const last = txs[txs.length - 1] as Transaction;
    const price = allQuotes.find((q) => q.assetId === assetId)?.price ?? null;
    const value = price !== null && quantity > 0 ? price * quantity : null;

    positions.push({
      assetId,
      symbol: last.symbol,
      currency: last.currency,
      quantity,
      costBasis: Math.round(cost * 100) / 100,
      averageCost: quantity > 0 ? cost / quantity : null,
      realisedPnl: Math.round(realised * 100) / 100,
      feesPaid: Math.round(fees * 100) / 100,
      marketValue: value === null ? null : Math.round(value * 100) / 100,
      unrealisedPnl: value === null ? null : Math.round((value - cost) * 100) / 100,
      unrealisedPct: value === null || cost <= 0 ? null : ((value - cost) / cost) * 100,
      lastPrice: price,
      oversold,
      transactionCount: txs.length,
    });
  }

  positions.sort((a, b) => (b.marketValue ?? b.costBasis) - (a.marketValue ?? a.costBasis));

  const currency = state.preferences.displayCurrency;
  const mine = positions.filter((p) => p.currency === currency);
  const excluded = [
    ...new Set(positions.filter((p) => p.currency !== currency).map((p) => p.currency)),
  ];
  const open = mine.filter((p) => p.quantity > 0);

  const marketValue = open.reduce((n, p) => n + (p.marketValue ?? 0), 0);
  const costBasis = open.reduce((n, p) => n + p.costBasis, 0);
  const unpriced = open.filter((p) => p.marketValue === null).map((p) => p.symbol);

  return {
    positions,
    marketValue: Math.round(marketValue * 100) / 100,
    costBasis: Math.round(costBasis * 100) / 100,
    unrealisedPnl: Math.round((marketValue - costBasis) * 100) / 100,
    unrealisedPct:
      costBasis > 0 && unpriced.length === 0 ? ((marketValue - costBasis) / costBasis) * 100 : null,
    realisedPnl: Math.round(mine.reduce((n, p) => n + p.realisedPnl, 0) * 100) / 100,
    feesPaid: Math.round(mine.reduce((n, p) => n + p.feesPaid, 0) * 100) / 100,
    currency,
    unpriced,
    excludedCurrencies: excluded,
    method: state.preferences.costBasisMethod === 'average' ? 'average' : 'fifo',
  };
}

let newsFeeds: NewsFeed[] = defaultFeeds();
let feedSeq = 0;

const allQuotes: Quote[] = [...(cryptoQuotes as Quote[]), ...(stockQuotes as Quote[])];
const allAssets: Asset[] = searchIndex as Asset[];
/**
 * Fixture timestamps are frozen so tests stay deterministic, but a fixed base date drifts into
 * the past and every headline renders as "last yr". Rebasing at load keeps the relative spacing
 * while making the stories plausibly recent. Mirrors `rebase_to_now` in the Rust mock provider.
 */
function rebaseToNow(articles: NewsArticle[]): NewsArticle[] {
  const stamps = articles
    .map((a) => a.publishedAt)
    .filter((t): t is number => typeof t === 'number');
  if (stamps.length === 0) return articles;

  const newest = Math.max(...stamps);
  const offset = Math.floor(Date.now() / 1000) - newest - 120;

  return articles.map((article) =>
    article.publishedAt === null
      ? article
      : { ...article, publishedAt: article.publishedAt + offset },
  );
}

const allNews: NewsArticle[] = rebaseToNow(newsFixture as NewsArticle[]);

/** The same rebasing for community posts, and for the same reason. */
const allCommunity: CommunityPost[] = (() => {
  const posts = communityFixture as CommunityPost[];
  const stamps = posts.map((p) => p.postedAt).filter((t): t is number => typeof t === 'number');
  if (stamps.length === 0) return posts;

  const newest = Math.max(...stamps);
  const offset = Math.floor(Date.now() / 1000) - newest - 120;

  return posts.map((post) =>
    post.postedAt === null ? post : { ...post, postedAt: post.postedAt + offset },
  );
})();

function meta(overrides: Partial<EnvelopeMeta> = {}): EnvelopeMeta {
  return {
    providerId: PROVIDER_ID,
    providerName: PROVIDER_NAME,
    fetchedAt: new Date().toISOString(),
    source: 'mock',
    stale: false,
    degraded: null,
    ...overrides,
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Applies the dev panel's forced behaviour. Every UI state — including every failure — is
 * reachable here without a network connection, which is what makes the Phase 1 state coverage
 * testable at all.
 */
async function envelope<T>(data: T, emptyValue: T): Promise<Envelope<T>> {
  switch (mockBehavior) {
    case 'slow':
      await delay(2500);
      return { data, meta: meta() };
    case 'empty':
      return { data: emptyValue, meta: meta() };
    case 'stale':
      return {
        data,
        meta: meta({
          stale: true,
          fetchedAt: new Date(Date.now() - 45 * 60_000).toISOString(),
          source: 'cache',
        }),
      };
    case 'rate-limited':
      return {
        data,
        meta: meta({
          stale: true,
          source: 'cache',
          fetchedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
          degraded: {
            reason: 'rate_limited',
            retryAfter: new Date(Date.now() + 60_000).toISOString(),
            message: 'Provider request limit reached. Showing cached values; retrying shortly.',
          },
        }),
      };
    case 'error':
      return {
        data,
        meta: meta({
          stale: true,
          source: 'cache',
          fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
          degraded: {
            reason: 'provider_error',
            retryAfter: null,
            message: 'The provider did not respond as expected. Showing the last known values.',
          },
        }),
      };
    case 'not-configured':
      return {
        data: emptyValue,
        meta: meta({
          degraded: {
            reason: 'not_configured',
            retryAfter: null,
            message: 'No provider is set up for this data yet. Add one in Settings → Providers.',
          },
        }),
      };
    default:
      await delay(120);
      return { data, meta: meta() };
  }
}

function reindex(items: WatchlistItem[], watchlistId: string): WatchlistItem[] {
  const inList = items
    .filter((i) => i.watchlistId === watchlistId)
    .sort((a, b) => a.position - b.position)
    .map((item, index) => ({ ...item, position: index }));
  return [...items.filter((i) => i.watchlistId !== watchlistId), ...inList];
}

/*
 * Model Desk state for the harness.
 *
 * This is a fixture server, not a second implementation: there is no real endpoint, so a send
 * returns a canned educational answer. What it *does* faithfully reproduce is the shape of the
 * chain — status, preview arithmetic, the outbound log growing on every send — because that is
 * what the UI is built and tested against. The guardrail prompt itself lives only in Rust.
 */
const HARNESS_SYSTEM_PROMPT_CHARS = 2751;

interface HarnessAiProvider {
  endpoint: string | null;
  model: string | null;
  hasCredential: boolean;
}

interface HarnessAi {
  local: HarnessAiProvider;
  cloud: HarnessAiProvider;
  conversations: AiConversation[];
  messages: AiMessage[];
  outbound: AiOutboundEntry[];
  nextId: number;
}

function emptyAi(): HarnessAi {
  return {
    local: { endpoint: null, model: null, hasCredential: false },
    cloud: { endpoint: null, model: null, hasCredential: false },
    conversations: [],
    messages: [],
    outbound: [],
    nextId: 1,
  };
}

let ai: HarnessAi = emptyAi();

/** Mirrors `providers::ai::resolve_reach` for the shapes a browser can decide without DNS. */
function harnessReach(endpoint: string | null): 'loopback' | 'network' | null {
  if (!endpoint) return null;
  try {
    const host = new URL(endpoint).hostname.replace(/^\[|\]$/g, '');
    return host === '127.0.0.1' || host === '::1' || host === 'localhost' ? 'loopback' : 'network';
  } catch {
    return null;
  }
}

function summarise(provider: HarnessAiProvider) {
  return {
    configured: provider.endpoint !== null && provider.model !== null,
    endpoint: provider.endpoint,
    model: provider.model,
    hasCredential: provider.hasCredential,
  };
}

function harnessAiStatus(): AiStatus {
  const mode = state.preferences.aiMode;
  const active = mode === 'cloud' ? ai.cloud : ai.local;
  const reach = harnessReach(active.endpoint);

  const label =
    mode === 'cloud'
      ? active.endpoint
        ? 'Cloud \u00b7 API'
        : null
      : reach === 'loopback'
        ? 'Local \u00b7 offline'
        : reach === 'network'
          ? 'Local endpoint \u00b7 network'
          : null;

  const requiresCredential = mode === 'cloud';

  return {
    configured:
      active.endpoint !== null &&
      active.model !== null &&
      (!requiresCredential || active.hasCredential),
    enabled: state.preferences.aiEnabled,
    mode,
    endpoint: active.endpoint,
    model: active.model,
    reach,
    reachLabel: label,
    leavesDevice: mode === 'cloud' || reach === 'network',
    requiresCredential,
    hasCredential: active.hasCredential,
    systemPromptVersion: 'v1',
    local: summarise(ai.local),
    cloud: summarise(ai.cloud),
  };
}

function harnessHistoryChars(conversationId: string | null): number {
  if (!conversationId) return 0;
  return ai.messages
    .filter((m) => m.conversationId === conversationId)
    .reduce((total, m) => total + m.content.length, 0);
}

function harnessContextChars(context: AiContextItem[]): number {
  // Matches the Rust wrapper: open tag, text, close tag, newlines.
  return context.reduce((total, item) => total + item.text.length + 41, 0);
}

/*
 * Encrypted-profile state for the harness.
 *
 * There is no filesystem and no crypto here — a "file" is an in-memory record keyed by the fake
 * path `lib/dialog.ts` returns outside Tauri. What this reproduces faithfully is the *shape* of
 * the flow the UI is built against: a wrong password fails, a summary is produced before
 * anything is written, and merge and replace differ. The real construction and its guarantees
 * live in Rust and are tested there — see `src-tauri/src/security/profile.rs`.
 */
interface HarnessProfileFile {
  password: string;
  summary: ProfileSummary;
}

const harnessFiles = new Map<string, HarnessProfileFile>();

function harnessSummary(): ProfileSummary {
  return {
    schemaVersion: 2,
    appVersion: '0.1.0-dev',
    exportedAt: Math.floor(Date.now() / 1000),
    watchlists: state.watchlists.length,
    watchlistItems: state.items.length,
    notes: state.notes.length,
    progress: state.progress.length,
    bookmarks: 0,
    preferences: Object.keys(state.preferences).length,
    providers: Object.keys(providerState).length,
    assets: state.items.length,
  };
}

/**
 * Ninety days of readings that drift into `latest`.
 *
 * Deterministic, so a snapshot of the panel does not change between runs, and bounded to the
 * 0–100 scale the same way the Rust side bounds it.
 */
function sentimentHistory(latest: number): { time: number; value: number }[] {
  const end = 1_788_177_600;
  return Array.from({ length: 90 }, (_, i) => {
    const drift = Math.sin(i / 11) * 14 + Math.sin(i / 3.7) * 4;
    const pull = ((i / 89) * (latest - 50)) / 1;
    const value = Math.round(Math.min(100, Math.max(0, 50 + drift * (1 - i / 120) + pull)));
    return { time: end - (89 - i) * 86_400, value: i === 89 ? latest : value };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the typed contract is enforced at the `ipc()` call site; this is the untyped seam.
export async function browserInvoke(command: string, args?: any): Promise<unknown> {
  callCounts.set(command, (callCounts.get(command) ?? 0) + 1);

  switch (command) {
    case 'get_app_info':
      return {
        version: '0.1.0-dev',
        dataDir: '(browser harness — no local database)',
        dbPath: '(browser harness — no local database)',
        schemaVersion: 0,
        isMockMode: true,
      };

    case 'get_preferences':
      return state.preferences;

    case 'set_preference': {
      const key = args.key as keyof Preferences;
      state = {
        ...state,
        preferences: { ...state.preferences, [key]: JSON.parse(args.value) as unknown },
      };
      saveState(state);
      return null;
    }

    case 'list_providers':
      /*
       * Mirrors the provider set the Rust registry seeds, so the Settings UI can be built and
       * checked in the harness. State is held in `harnessProviders` below rather than being a
       * constant, so enabling a provider or saving a key visibly changes the page.
       */
      return harnessProviders();

    case 'list_watchlists':
      return state.watchlists;

    case 'get_watchlist_items':
      return state.items
        .filter((i) => i.watchlistId === args.watchlistId)
        .sort((a, b) => a.position - b.position);

    case 'create_watchlist': {
      const created: Watchlist = {
        id: `wl-${Date.now()}`,
        name: args.name,
        position: state.watchlists.length,
        isDefault: false,
      };
      state = { ...state, watchlists: [...state.watchlists, created] };
      saveState(state);
      return created;
    }

    case 'rename_watchlist':
      state = {
        ...state,
        watchlists: state.watchlists.map((w) =>
          w.id === args.watchlistId ? { ...w, name: args.name } : w,
        ),
      };
      saveState(state);
      return null;

    case 'delete_watchlist':
      state = {
        ...state,
        watchlists: state.watchlists.filter((w) => w.id !== args.watchlistId),
        items: state.items.filter((i) => i.watchlistId !== args.watchlistId),
      };
      saveState(state);
      return null;

    case 'add_watchlist_item': {
      const exists = state.items.some(
        (i) => i.watchlistId === args.watchlistId && i.assetId === args.assetId,
      );
      if (!exists) {
        const position = state.items.filter((i) => i.watchlistId === args.watchlistId).length;
        state = {
          ...state,
          items: [
            ...state.items,
            {
              watchlistId: args.watchlistId,
              assetId: args.assetId,
              position,
              addedAt: Math.floor(Date.now() / 1000),
            },
          ],
        };
        saveState(state);
      }
      return null;
    }

    case 'remove_watchlist_item':
      state = {
        ...state,
        items: reindex(
          state.items.filter(
            (i) => !(i.watchlistId === args.watchlistId && i.assetId === args.assetId),
          ),
          args.watchlistId,
        ),
      };
      saveState(state);
      return null;

    case 'reorder_watchlist_items': {
      const order = args.assetIds as string[];
      state = {
        ...state,
        items: state.items.map((i) =>
          i.watchlistId === args.watchlistId && order.includes(i.assetId)
            ? { ...i, position: order.indexOf(i.assetId) }
            : i,
        ),
      };
      saveState(state);
      return null;
    }

    case 'search_assets': {
      const query = String(args.query ?? '').trim();
      if (!query) return envelope<AssetSearchResult[]>([], []);
      const results = allAssets
        .map((asset) => ({
          asset,
          score: Math.max(scoreMatch(query, asset.symbol) * 1.2, scoreMatch(query, asset.name)),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, args.limit ?? 20);
      return envelope<AssetSearchResult[]>(results, []);
    }

    case 'get_market_list': {
      // Mirrors the Rust mock: region lives on the canonical asset, not on the quote.
      const regionOf = new Map(allAssets.map((asset) => [asset.id, asset.region]));
      const rows = allQuotes
        .filter((q) => q.assetType === args.assetType)
        .filter((q) => args.region === 'global' || regionOf.get(q.assetId) === args.region)
        .slice(0, args.limit ?? 50);
      return envelope<Quote[]>(rows, []);
    }

    case 'get_quotes': {
      const ids = new Set(args.assetIds as string[]);
      return envelope<Quote[]>(
        allQuotes.filter((q) => ids.has(q.assetId)),
        [],
      );
    }

    case 'get_asset':
      return allAssets.find((a) => a.id === args.assetId) ?? null;

    case 'get_chart': {
      // Mirrors the Rust mock: the fixture is a year of daily closes, so a range is a tail.
      const series = (chartFixture as Record<string, ChartPoint[]>)[args.assetId as string];
      if (!series) return envelope<ChartPoint[]>([], []);

      const days: Record<ChartRange, number> = {
        '1D': 2,
        '1W': 7,
        '1M': 30,
        '3M': 90,
        '1Y': series.length,
        MAX: series.length,
      };
      const take = days[args.range as ChartRange] ?? series.length;
      return envelope<ChartPoint[]>(series.slice(Math.max(0, series.length - take)), []);
    }

    case 'get_news': {
      const filter = args.filter as { category: string; limit: number };
      const rows = allNews
        .filter((n) => filter.category === 'all' || n.category === filter.category)
        .slice(0, filter.limit ?? 20);
      return envelope<NewsArticle[]>(rows, []);
    }

    case 'list_alerts':
      return harnessAlerts.map((a) => ({ ...a }));

    case 'create_alert': {
      const input = args.alert as Alert;
      if (!Number.isFinite(input.threshold)) {
        throw { kind: 'validation', message: 'That threshold is not a number.' };
      }
      if (!input.kind.startsWith('change') && input.threshold < 0) {
        throw { kind: 'validation', message: 'A price threshold cannot be negative.' };
      }
      alertSeq += 1;
      const created: Alert = { ...input, id: `alert-${alertSeq}`, createdAt: 1_760_000_000 };
      harnessAlerts = [...harnessAlerts, created];
      return { ...created };
    }

    case 'delete_alert':
      harnessAlerts = harnessAlerts.filter((a) => a.id !== args.id);
      return null;

    case 'set_alert_enabled':
      harnessAlerts = harnessAlerts.map((a) =>
        a.id === args.id ? { ...a, enabled: Boolean(args.enabled) } : a,
      );
      return null;

    case 'rearm_alert':
      harnessAlerts = harnessAlerts.map((a) =>
        a.id === args.id ? { ...a, triggeredAt: null, triggeredValue: null } : a,
      );
      return null;

    case 'check_alerts': {
      // Mirrors the Rust rule: nothing happens while the preference is off, and an alert that
      // has already fired stays quiet.
      if (!state.preferences.alertsEnabled) return [];

      const fired: TriggeredAlert[] = [];
      harnessAlerts = harnessAlerts.map((alert) => {
        if (!alert.enabled || alert.triggeredAt !== null) return alert;
        const quote = allQuotes.find((q) => q.assetId === alert.assetId);
        if (!quote) return alert;

        const value =
          alert.kind === 'change-above' || alert.kind === 'change-below'
            ? quote.changePct24h
            : quote.price;
        if (value === null || !Number.isFinite(value)) return alert;

        const tripped =
          alert.kind === 'price-above' || alert.kind === 'change-above'
            ? value >= alert.threshold
            : value <= alert.threshold;
        if (!tripped) return alert;

        const triggered = { ...alert, triggeredAt: 1_760_000_500, triggeredValue: value };
        fired.push({ alert: triggered, message: `${alert.symbol} reached ${value}` });
        return triggered;
      });
      return fired;
    }

    case 'list_macro_series':
      return [
        {
          id: 'DGS10',
          name: '10-year Treasury yield',
          description: 'What the US government pays to borrow for ten years.',
          unit: '%',
          frequency: 'Daily',
        },
        {
          id: 'UNRATE',
          name: 'Unemployment rate',
          description: 'The share of the US labour force without work and looking for it.',
          unit: '%',
          frequency: 'Monthly',
        },
      ];

    case 'get_macro_series': {
      // A plausible shape; the parser and its edge cases are tested on the Rust side.
      const points = Array.from({ length: 60 }, (_, i) => ({
        time: 1_755_820_800 + i * 86_400,
        close: 4 + Math.sin(i / 8) * 0.4,
      }));
      return envelope<ChartPoint[]>(points, []);
    }

    case 'get_multi_series': {
      const ids = (args.assetIds as string[]).slice(0, 6);
      const known = new Set(allQuotes.map((q) => q.assetId));
      return {
        series: ids
          .filter((id) => known.has(id))
          .map((assetId, index) => ({
            assetId,
            symbol: assetId.split(':').pop()?.toUpperCase() ?? assetId,
            points: Array.from({ length: 90 }, (_, i) => ({
              time: 1_750_000_000 + i * 86_400,
              // Distinct shapes, so a correlation matrix over them is not all ones.
              close: 100 + Math.sin(i / (4 + index * 3)) * 12 + i * (index % 2 === 0 ? 0.3 : -0.2),
            })),
          })),
        unavailable: ids.filter((id) => !known.has(id)),
      };
    }

    case 'get_crypto_sentiment':
      return envelope<SentimentIndex | null>(
        {
          market: 'crypto',
          basis: 'published',
          value: 69,
          band: 'greed',
          asOf: 1_788_220_800,
          publisherLabel: 'Greed',
          components: [],
          history: sentimentHistory(69),
          methodology:
            'Published daily by Alternative.me from Bitcoin volatility (25%), market momentum ' +
            'and volume (25%), social media activity (15%), BTC dominance (10%) and Google ' +
            'Trends (10%). It describes Bitcoin, which the rest of the crypto market usually ' +
            'but does not always follow.',
        },
        null,
      );

    case 'get_stock_sentiment':
      return envelope<SentimentIndex | null>(
        {
          market: 'stocks',
          basis: 'computed',
          value: 68,
          band: 'greed',
          asOf: 1_788_177_600,
          publisherLabel: null,
          // Real values from a live run, so the panel is laid out against numbers of the
          // shape it will actually meet rather than round ones.
          components: [
            {
              id: 'momentum',
              name: 'Market momentum',
              description:
                'Where the S&P 500 sits against its own recent average. Well above it, buyers ' +
                'have been paying up.',
              score: 52,
              band: 'neutral',
              rawValue: 5.576,
              rawUnit: '%',
              reading: 'The S&P 500 is 5.6% above its 125-session average.',
              sourceSeries: ['SP500'],
              method:
                'S&P 500 divided by its 125-session average, then ranked against the last 252 ' +
                'sessions.',
              inverted: false,
            },
            {
              id: 'volatility',
              name: 'Market volatility',
              description:
                'How much movement the options market expects, against its own recent normal. ' +
                'Calm markets are confident ones.',
              score: 68,
              band: 'greed',
              rawValue: -9.293,
              rawUnit: '%',
              reading: 'The VIX is 9.3% below its 50-session average.',
              sourceSeries: ['VIXCLS'],
              method:
                'VIX divided by its 50-session average, ranked against the last 252 sessions, ' +
                'then inverted — a high VIX is fear.',
              inverted: true,
            },
            {
              id: 'safe-haven',
              name: 'Safe-haven demand',
              description:
                'Whether money has been going into stocks or into bonds. Bonds beating stocks ' +
                'is the classic flight to safety.',
              score: 53,
              band: 'neutral',
              rawValue: 1.003,
              rawUnit: 'pp',
              reading:
                'Over 20 sessions stocks returned 1.0 percentage points more than ' +
                'investment-grade bonds.',
              sourceSeries: ['SP500', 'BAMLCC0A0CMTRIV'],
              method:
                '20-session return on the S&P 500 minus the 20-session total return on ' +
                'investment-grade corporate bonds, ranked against the last 252 sessions.',
              inverted: false,
            },
            {
              id: 'junk-bond-demand',
              name: 'Junk bond demand',
              description:
                'The extra yield demanded to lend to the riskiest companies. When that ' +
                'premium is thin, lenders are relaxed about risk.',
              score: 99,
              band: 'extreme-greed',
              rawValue: 1.83,
              rawUnit: 'pp',
              reading:
                'Riskier borrowers are paying 1.83 percentage points more than ' +
                'investment-grade ones.',
              sourceSeries: ['BAMLH0A0HYM2', 'BAMLC0A0CM'],
              method:
                'High-yield spread minus investment-grade spread, ranked against the last 252 ' +
                'sessions, then inverted — a wide premium is fear.',
              inverted: true,
            },
          ],
          history: sentimentHistory(68),
          methodology:
            'Computed here from 5 public Federal Reserve series. Each of the four components ' +
            "is scored by where today's reading falls among the last 252 sessions, and the " +
            'index is their equal-weighted average. Nobody publishes this number — it is this ' +
            "app's arithmetic, and every step of it is shown above.",
        },
        null,
      );

    case 'run_screen': {
      // Mirrors the Rust filter semantics closely enough for the UI to be exercised; the
      // authoritative implementation and its tests live in `models::screener`.
      const f = args.filter as ScreenerFilter;
      const within = (value: number | null, range: { min: number | null; max: number | null }) => {
        if (value === null || !Number.isFinite(value))
          return range.min === null && range.max === null;
        return (
          (range.min === null || value >= range.min) && (range.max === null || value <= range.max)
        );
      };
      const q = (f.query ?? '').trim().toLowerCase();

      let rows = allQuotes.filter((quote) => {
        if (f.assetType !== null && quote.assetType !== f.assetType) return false;
        if (
          q !== '' &&
          !quote.symbol.toLowerCase().includes(q) &&
          !quote.name.toLowerCase().includes(q)
        ) {
          return false;
        }
        return (
          within(quote.price, f.price) &&
          within(quote.marketCap, f.marketCap) &&
          within(quote.changePct24h, f.change24h) &&
          within(quote.changePct7d, f.change7d) &&
          within(quote.volume24h, f.volume24h)
        );
      });

      const keyOf = (quote: Quote): number | null => {
        switch (f.sort) {
          case 'price':
            return quote.price;
          case 'change24h':
            return quote.changePct24h;
          case 'change7d':
            return quote.changePct7d;
          case 'volume':
            return quote.volume24h;
          case 'market-cap':
            return quote.marketCap;
          default:
            return null;
        }
      };

      rows = [...rows].sort((a, b) => {
        if (f.sort === 'symbol') {
          const cmp = a.symbol.toLowerCase().localeCompare(b.symbol.toLowerCase());
          return f.descending ? -cmp : cmp;
        }
        const x = keyOf(a);
        const y = keyOf(b);
        // Unknown sorts last in both directions, matching Rust.
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return f.descending ? y - x : x - y;
      });

      return envelope<Quote[]>(rows, []);
    }

    case 'get_portfolio':
      return harnessPortfolio();

    case 'list_transactions': {
      const rows = args.assetId
        ? portfolioTx.filter((t) => t.assetId === args.assetId)
        : [...portfolioTx];
      return rows.sort((a, b) => b.executedAt - a.executedAt).map((t) => ({ ...t }));
    }

    case 'add_transaction': {
      const input = args.transaction as Transaction;
      if (!(input.quantity > 0)) {
        throw { kind: 'validation', message: 'Quantity must be a positive number.' };
      }
      if (!(input.unitPrice >= 0)) {
        throw { kind: 'validation', message: 'Price cannot be negative.' };
      }
      txSeq += 1;
      const created: Transaction = { ...input, id: `tx-${txSeq}`, createdAt: input.executedAt };
      portfolioTx = [...portfolioTx, created];
      return { ...created };
    }

    case 'update_transaction': {
      const input = args.transaction as Transaction;
      if (!portfolioTx.some((t) => t.id === input.id)) {
        throw { kind: 'not_found', message: 'That transaction no longer exists.' };
      }
      portfolioTx = portfolioTx.map((t) => (t.id === input.id ? { ...input } : t));
      return { ...input };
    }

    case 'delete_transaction': {
      const before = portfolioTx.length;
      portfolioTx = portfolioTx.filter((t) => t.id !== args.id);
      if (portfolioTx.length === before) {
        throw { kind: 'not_found', message: 'That transaction no longer exists.' };
      }
      return null;
    }

    case 'get_local_models':
      return structuredClone(localModels);

    case 'install_engine':
      localModels = {
        ...localModels,
        engine: { ...localModels.engine, installed: true },
        diskUsedBytes: localModels.diskUsedBytes + 11_027_677,
      };
      return structuredClone(localModels);

    case 'download_model': {
      localModels = {
        ...localModels,
        models: localModels.models.map((m) =>
          m.id === args.modelId ? { ...m, installed: true, partialBytes: 0 } : m,
        ),
        diskUsedBytes:
          localModels.diskUsedBytes +
          (localModels.models.find((m) => m.id === args.modelId)?.sizeBytes ?? 0),
      };
      return structuredClone(localModels);
    }

    case 'get_download_progress':
      return null;

    case 'cancel_download':
      return null;

    case 'delete_local_model': {
      const removed = localModels.models.find((m) => m.id === args.modelId);
      localModels = {
        ...localModels,
        models: localModels.models.map((m) =>
          m.id === args.modelId ? { ...m, installed: false, partialBytes: 0 } : m,
        ),
        engine:
          localModels.engine.loadedModel === args.modelId
            ? { ...localModels.engine, running: false, loadedModel: null }
            : localModels.engine,
        diskUsedBytes: Math.max(
          0,
          localModels.diskUsedBytes - (removed?.installed ? (removed.sizeBytes ?? 0) : 0),
        ),
      };
      return structuredClone(localModels);
    }

    case 'start_local_model': {
      if (!localModels.engine.installed) {
        throw { kind: 'storage', message: 'The engine is not installed. Download it first.' };
      }
      localModels = {
        ...localModels,
        engine: {
          ...localModels.engine,
          running: true,
          loadedModel: String(args.modelId),
        },
      };
      return structuredClone(localModels);
    }

    case 'stop_local_model':
      localModels = {
        ...localModels,
        engine: { ...localModels.engine, running: false, loadedModel: null },
      };
      return structuredClone(localModels);

    case 'check_for_updates':
      // The harness never reaches the network. This models the "already current" answer;
      // the other branches are exercised by unit tests on the Rust side.
      return {
        currentVersion: '0.1.0',
        latestVersion: 'v0.1.0',
        updateAvailable: false,
        comparisonFailed: false,
        releaseUrl: 'https://github.com/KleivinX/Brew-Terminal/releases/tag/v0.1.0',
        publishedAt: '2026-08-25T11:53:44Z',
        prerelease: true,
      };

    case 'list_news_feeds':
      return newsFeeds.map((f) => ({ ...f }));

    case 'preview_news_feed': {
      const url = String(args.url ?? '');
      if (!url.startsWith('https://')) {
        throw { kind: 'validation', message: 'A feed address must start with https://' };
      }
      return { title: 'A Publisher', itemCount: 12, newestTitle: 'A recent headline' };
    }

    case 'add_news_feed': {
      const url = String(args.url ?? '');
      if (!url.startsWith('https://')) {
        throw { kind: 'validation', message: 'A feed address must start with https://' };
      }
      const existing = newsFeeds.find((f) => f.url === url);
      if (existing) return { ...existing };

      feedSeq += 1;
      const feed: NewsFeed = {
        id: `feed-added-${feedSeq}`,
        title: String(args.title ?? '') || 'A Publisher',
        url,
        category: args.category as NewsCategory,
        enabled: true,
        isDefault: false,
        addedAt: Math.floor(Date.now() / 1000),
        lastOkAt: Math.floor(Date.now() / 1000),
        lastError: null,
      };
      newsFeeds = [...newsFeeds, feed];
      return { ...feed };
    }

    case 'remove_news_feed':
      newsFeeds = newsFeeds.filter((f) => f.id !== args.feedId);
      return null;

    case 'set_news_feed_enabled':
      newsFeeds = newsFeeds.map((f) =>
        f.id === args.feedId ? { ...f, enabled: Boolean(args.enabled) } : f,
      );
      return null;

    case 'restore_default_news_feeds': {
      const custom = newsFeeds.filter((f) => !f.isDefault);
      newsFeeds = [...defaultFeeds(), ...custom];
      return newsFeeds.map((f) => ({ ...f }));
    }

    case 'set_provider_enabled': {
      const entry = providerState[args.providerId as string];
      if (entry) entry.enabled = Boolean(args.enabled);
      return null;
    }

    case 'save_provider_credential': {
      // The hosted model provider stores its key under the same one-way path as the market
      // providers, so it is handled here rather than in a Model Desk command of its own.
      if (args.providerId === 'cloud-openai') {
        ai.cloud = { ...ai.cloud, hasCredential: true };
      }
      const entry = providerState[args.providerId as string];
      if (entry) {
        entry.hasCredential = true;
        // A provider the user just keyed is one they want on.
        entry.enabled = true;
      }
      // The harness has no keychain. It returns the same masked shape the real command does,
      // and deliberately never echoes the key back.
      const key = String(args.apiKey);
      return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '…'.repeat(4);
    }

    case 'delete_provider_credential': {
      if (args.providerId === 'cloud-openai') {
        ai.cloud = { ...ai.cloud, hasCredential: false };
      }
      const entry = providerState[args.providerId as string];
      if (entry) {
        entry.hasCredential = false;
        entry.enabled = false;
      }
      return null;
    }

    case 'test_provider':
      return { ok: true, message: 'Connected. Mock provider (fixtures) answered with data.' };

    case 'list_progress':
      return state.progress;

    case 'set_progress': {
      const now = Math.floor(Date.now() / 1000);
      const record: LearningProgress = {
        itemId: args.itemId,
        pathId: args.pathId,
        status: args.status,
        completedAt: args.status === 'completed' ? now : null,
        updatedAt: now,
      };
      state = {
        ...state,
        progress: [...state.progress.filter((p) => p.itemId !== record.itemId), record],
      };
      saveState(state);
      return null;
    }

    case 'reset_progress':
      state = {
        ...state,
        progress: args.pathId ? state.progress.filter((p) => p.pathId !== args.pathId) : [],
      };
      saveState(state);
      return null;

    case 'list_all_notes':
      return [...state.notes].sort(
        (a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt,
      );

    case 'list_notes':
      return state.notes
        .filter((note) => note.assetId === args.assetId)
        .sort((a, b) => b.updatedAt - a.updatedAt);

    case 'upsert_note': {
      const now = Math.floor(Date.now() / 1000);
      const existing = state.notes.find((note) => note.id === args.noteId);

      const note: Note = existing
        ? { ...existing, title: args.title, bodyMd: args.bodyMd, updatedAt: now }
        : {
            id: `note-${now}-${Math.random().toString(36).slice(2, 8)}`,
            assetId: args.assetId ?? null,
            title: args.title,
            bodyMd: args.bodyMd,
            createdAt: now,
            updatedAt: now,
          };

      state = {
        ...state,
        notes: existing
          ? state.notes.map((n) => (n.id === note.id ? note : n))
          : [...state.notes, note],
      };
      saveState(state);
      return note;
    }

    case 'delete_note':
      state = { ...state, notes: state.notes.filter((note) => note.id !== args.noteId) };
      saveState(state);
      return null;

    case 'export_csv': {
      // No filesystem here. Reports what the real command would have written so the button's
      // success path is exercised in the fast loop; the .csv guard is asserted in Rust.
      const csv = String(args.csv ?? '');
      return {
        path: String(args.path ?? ''),
        bytes: new TextEncoder().encode(csv).length,
        rows: Math.max(0, csv.split(/\r?\n/).filter(Boolean).length - 1),
      };
    }

    case 'restore_note': {
      // Mirrors the Rust path: idempotent, and the living copy wins over the restored one.
      const incoming = args.note as Note;
      const existing = state.notes.find((note) => note.id === incoming.id);
      if (existing) return existing;

      state = { ...state, notes: [...state.notes, incoming] };
      saveState(state);
      return incoming;
    }

    case 'search_notes': {
      // The real command uses SQLite FTS5; substring matching is close enough to drive the UI.
      const needle = String(args.query).trim().toLowerCase();
      if (!needle) return [];
      return state.notes
        .filter(
          (note) =>
            note.title.toLowerCase().includes(needle) || note.bodyMd.toLowerCase().includes(needle),
        )
        .slice(0, args.limit ?? 20);
    }

    case 'get_ai_status':
      return harnessAiStatus();

    case 'save_ai_endpoint': {
      const reach = harnessReach(args.endpoint as string);
      if (reach === null) {
        throw { kind: 'validation', message: 'The value for "endpoint" is not valid.' };
      }
      if (reach === 'network' && !(args.endpoint as string).startsWith('https://')) {
        throw { kind: 'validation', message: 'The value for "endpoint" is not valid.' };
      }
      ai.local = {
        ...ai.local,
        endpoint: args.endpoint as string,
        model: args.model as string,
      };
      return harnessAiStatus();
    }

    case 'save_ai_cloud_endpoint': {
      // No loopback exemption: a hosted endpoint carries a key.
      if (!(args.endpoint as string).startsWith('https://')) {
        throw { kind: 'validation', message: 'The value for "endpoint" is not valid.' };
      }
      ai.cloud = {
        ...ai.cloud,
        endpoint: args.endpoint as string,
        model: args.model as string,
      };
      return harnessAiStatus();
    }

    case 'clear_ai_endpoint': {
      const which = args.mode === 'cloud' ? 'cloud' : 'local';
      ai[which] = { ...ai[which], endpoint: null, model: null };
      return harnessAiStatus();
    }

    case 'test_ai_endpoint': {
      const status = harnessAiStatus();
      if (!status.configured)
        throw { kind: 'ai_not_configured', message: 'No model is set up yet.' };
      return {
        ok: true,
        message: 'Connected. 3 models available, including the one you named.',
        modelAvailable: true,
        reachLabel: status.reachLabel ?? '',
      };
    }

    case 'preview_ai_send': {
      const context = (args.context ?? []) as AiContextItem[];
      const prompt = args.prompt as string;
      const historyChars = harnessHistoryChars(args.conversationId as string | null);
      const contextChars = harnessContextChars(context);
      const status = harnessAiStatus();

      return {
        charCount: HARNESS_SYSTEM_PROMPT_CHARS + historyChars + prompt.length + contextChars,
        systemPromptChars: HARNESS_SYSTEM_PROMPT_CHARS,
        historyChars,
        promptChars: prompt.length,
        contextChars,
        contextLabels: context.map((item) => item.label),
        leavesDevice: status.leavesDevice,
        reachLabel: status.reachLabel,
      };
    }

    case 'send_ai_message': {
      const status = harnessAiStatus();
      if (!status.configured || !status.enabled) {
        throw { kind: 'ai_not_configured', message: 'No model is set up yet.' };
      }

      const prompt = args.prompt as string;
      const context = (args.context ?? []) as AiContextItem[];
      const now = Math.floor(Date.now() / 1000);
      const conversationId = (args.conversationId as string | null) ?? `conv-${ai.nextId++}`;
      const providerId = status.mode === 'cloud' ? 'cloud-openai' : 'local-openai';

      if (!ai.conversations.some((c) => c.id === conversationId)) {
        ai.conversations = [
          {
            id: conversationId,
            title: prompt.split('\n')[0]?.slice(0, 80) || 'Untitled',
            providerId,
            mode: status.mode,
            modelName: status.model,
            systemPromptVersion: 'v1',
            createdAt: now,
            updatedAt: now,
          },
          ...ai.conversations,
        ];
      }

      const userMessage: AiMessage = {
        id: `msg-${ai.nextId++}`,
        conversationId,
        role: 'user',
        content: prompt,
        createdAt: now,
      };
      const assistantMessage: AiMessage = {
        id: `msg-${ai.nextId++}`,
        conversationId,
        role: 'assistant',
        content:
          'This is the browser harness, not a model. In the desktop app your own endpoint ' +
          'answers here, governed by the guardrail prompt. Educational information only.',
        createdAt: now,
      };
      ai.messages = [...ai.messages, userMessage, assistantMessage];

      ai.outbound = [
        {
          id: `out-${ai.nextId++}`,
          providerId,
          mode: status.mode,
          conversationId,
          charCount: HARNESS_SYSTEM_PROMPT_CHARS + prompt.length + harnessContextChars(context),
          includedContext: JSON.stringify(
            context.map((item) => ({ kind: item.kind, label: item.label })),
          ),
          createdAt: now,
        },
        ...ai.outbound,
      ];

      await delay(200);
      return { conversationId, userMessage, assistantMessage };
    }

    case 'list_ai_conversations':
      return ai.conversations;

    case 'get_ai_messages':
      return ai.messages.filter((m) => m.conversationId === args.conversationId);

    case 'delete_ai_conversation':
      ai.conversations = ai.conversations.filter((c) => c.id !== args.conversationId);
      ai.messages = ai.messages.filter((m) => m.conversationId !== args.conversationId);
      return null;

    case 'clear_ai_conversations':
      ai.conversations = [];
      ai.messages = [];
      return null;

    case 'list_ai_outbound_log':
      return ai.outbound;

    case 'clear_ai_outbound_log':
      ai.outbound = [];
      return null;

    case 'export_profile': {
      const password = String(args.password);
      if ([...password].length < 12) {
        throw { kind: 'validation', message: 'The value for "password" is not valid.' };
      }
      const path = String(args.path);
      harnessFiles.set(path, { password, summary: harnessSummary() });
      return { path, bytes: 4096 };
    }

    case 'inspect_profile':
    case 'import_profile': {
      const path = String(args.path);
      const file = harnessFiles.get(path);
      if (!file) {
        throw { kind: 'validation', message: 'That is not a Brew Terminal profile.' };
      }
      if (file.password !== String(args.password)) {
        // The same variant for a wrong password and a tampered file, as in Rust.
        throw {
          kind: 'profile_auth_failed',
          message:
            'That password did not open the file, or the file has been altered since it was written. Nothing was imported.',
        };
      }
      if (command === 'inspect_profile') return file.summary;

      const mode = args.mode === 'replace' ? 'replace' : 'merge';
      if (mode === 'replace') {
        state = { ...state, notes: [], progress: [] };
        saveState(state);
      }
      return {
        mode,
        summary: file.summary,
        backupPath: '/harness/brew.pre-import-00000000-000000.bak',
      };
    }

    case 'get_community_posts': {
      // Both gates, mirrored from the service: the preference and an enabled provider.
      if (!state.preferences.communityEnabled || !providerState['mock-community']?.enabled) {
        throw {
          kind: 'not_configured',
          message: 'No provider is set up for this data yet. Add one in Settings → Providers.',
          providerId: 'community',
        };
      }
      const posts = allCommunity
        .slice()
        .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))
        .slice(0, args.filter?.limit ?? 20);
      await delay(80);
      return { data: posts, meta: meta() };
    }

    case 'get_cache_stats':
      return { entryCount: 0, totalBytes: 0, oldestFetchedAt: null };

    case 'clear_cache':
      return null;

    case 'set_mock_behavior':
      mockBehavior = args.behavior as MockBehavior;
      return null;

    default:
      throw new Error(`Browser harness has no handler for "${command}".`);
  }
}

/** Test seam: resets harness state between test cases. */
export function __resetHarness(): void {
  state = defaultState();
  mockBehavior = 'normal';
  callCounts.clear();
  providerState.coingecko = { enabled: true, hasCredential: false };
  providerState.finnhub = { enabled: false, hasCredential: false };
  providerState.mock = { enabled: true, hasCredential: false };
  providerState['mock-community'] = { enabled: true, hasCredential: false };
  ai = emptyAi();
  newsFeeds = defaultFeeds();
  feedSeq = 0;
  localModels = defaultLocalModels();
  portfolioTx = [];
  txSeq = 0;
  harnessAlerts = [];
  alertSeq = 0;
  harnessFiles.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
