import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Panel';
import { Icon } from '@/components/ui/Icon';
import { DataTable, type Column } from '@/components/data/DataTable';
import { SkeletonRows } from '@/components/status/Skeleton';
import { RelativeTime } from '@/components/status/RelativeTime';
import { ipc } from '@/lib/ipc';
import type { ConnectorInfo, ConnectorStage } from '@/types/domain';
import { ConnectorDetail } from './ConnectorDetail';
import { AUTH_LABEL, RISK_TONE, STAGE_LABEL, statusLabel } from './labels';
import styles from './ConnectorsRoute.module.css';

/**
 * The connectors browser.
 *
 * One screen that answers "where can this app get data from, and how much does it actually
 * know about each source". It is the counterpart to the provider badge on every panel: the
 * badge says which source served *this* number, and this says what that source is.
 *
 * The design decision worth knowing about is what is *missing* from most rows. Roughly ninety
 * of these connectors are candidates — a name and a category and nothing else — because nobody
 * has read their terms. A table with a plausible rate limit beside every name would assert a
 * hundred reviews that never happened, in the format most likely to be believed. So the
 * candidates are visibly empty, and the stage column says why.
 *
 * Nothing here writes. Switching a connector on is Settings, which already holds the one
 * credential path.
 */

type StageFilter = 'all' | ConnectorStage;

export function ConnectorsRoute() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [stage, setStage] = useState<StageFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => ipc('list_connectors'),
    // The catalogue is a compiled-in constant joined to a handful of database rows. It changes
    // when the user changes a provider, and that invalidates this key explicitly.
    staleTime: 60_000,
  });

  const connectors = useMemo(() => data?.connectors ?? [], [data]);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const connector of connectors) seen.set(connector.category, connector.categoryLabel);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [connectors]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return connectors.filter((connector) => {
      if (stage !== 'all' && connector.stage !== stage) return false;
      if (category !== 'all' && connector.category !== category) return false;
      if (needle === '') return true;
      return (
        connector.displayName.toLowerCase().includes(needle) ||
        connector.summary.toLowerCase().includes(needle) ||
        connector.categoryLabel.toLowerCase().includes(needle)
      );
    });
  }, [connectors, search, category, stage]);

  const open = connectors.find((connector) => connector.id === openId) ?? null;

  const columns: Column<ConnectorInfo>[] = useMemo(
    () => [
      {
        id: 'name',
        header: 'Connector',
        width: 'minmax(200px, 2fr)',
        sortable: true,
        sortValue: (row) => row.displayName.toLowerCase(),
        render: (row) => (
          <button
            type="button"
            className={styles.nameButton}
            onClick={() => setOpenId(row.id)}
            aria-label={`${row.displayName} — details`}
          >
            {row.displayName}
          </button>
        ),
      },
      {
        id: 'category',
        header: 'Category',
        width: 'minmax(140px, 1fr)',
        sortable: true,
        sortValue: (row) => row.categoryLabel,
        render: (row) => (
          <span className={styles.badge} data-kind="category">
            {row.categoryLabel}
          </span>
        ),
      },
      {
        id: 'stage',
        header: 'Review',
        width: '124px',
        sortable: true,
        sortValue: (row) => STAGE_ORDER[row.stage],
        render: (row) => (
          <span className={styles.badge} data-stage={row.stage}>
            {STAGE_LABEL[row.stage]}
          </span>
        ),
      },
      {
        id: 'terms',
        header: 'Terms',
        width: 'minmax(150px, 1fr)',
        sortable: true,
        sortValue: (row) => row.termsLabel ?? 'zzz',
        render: (row) =>
          row.termsRisk ? (
            <span className={styles.badge} data-tone={RISK_TONE[row.termsRisk]}>
              {row.termsLabel}
            </span>
          ) : (
            /*
              An em dash, not a guess. "Unknown" would be closer but still implies somebody
              looked; the dash plus the Review column together say the honest thing.
            */
            <span className={styles.empty} aria-label="No terms review">
              —
            </span>
          ),
      },
      {
        id: 'auth',
        header: 'Auth',
        width: '96px',
        sortable: true,
        sortValue: (row) => row.auth ?? 'zzz',
        render: (row) =>
          row.auth ? (
            <span className={styles.plain}>{AUTH_LABEL[row.auth]}</span>
          ) : (
            <span className={styles.empty} aria-label="Not known">
              —
            </span>
          ),
      },
      {
        id: 'status',
        header: 'Status',
        width: '104px',
        sortable: true,
        sortValue: (row) => statusLabel(row),
        render: (row) => (
          <span className={styles.status} data-on={row.enabled ? 'true' : undefined}>
            {statusLabel(row)}
          </span>
        ),
      },
      {
        id: 'checked',
        header: 'Last checked',
        width: '116px',
        sortable: true,
        sortValue: (row) => row.lastCheckedAt ?? 0,
        render: (row) =>
          row.lastCheckedAt !== null ? (
            <span className={styles.plain}>
              <RelativeTime epochSeconds={row.lastCheckedAt} />
            </span>
          ) : (
            <span className={styles.empty} aria-label="Never checked">
              —
            </span>
          ),
        cellLabel: (row) => (row.lastCheckedAt !== null ? 'checked' : 'never checked'),
      },
    ],
    [],
  );

  return (
    <>
      <WorkspaceHeader
        title="Connectors"
        subtitle="Every source this app can read, and how much it knows about each"
      />

      <div className={styles.layout}>
        <Panel
          title="Data sources"
          className={styles.panel}
          meta={
            data ? (
              <span className={styles.summary}>
                {`${data.summary.wired} wired (${data.summary.enabled} on) · ${data.summary.declined} declined · ${data.summary.candidates} not reviewed`}
              </span>
            ) : null
          }
          fill
        >
          <div className={styles.controls}>
            <label className="visually-hidden" htmlFor="connector-search">
              Search connectors
            </label>
            <input
              id="connector-search"
              type="search"
              className={styles.search}
              placeholder="Search by name, category or what it serves"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <label className="visually-hidden" htmlFor="connector-category">
              Filter by category
            </label>
            <select
              id="connector-category"
              className={styles.select}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">Every category</option>
              {categories.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>

            <label className="visually-hidden" htmlFor="connector-stage">
              Filter by review stage
            </label>
            <select
              id="connector-stage"
              className={styles.select}
              value={stage}
              onChange={(event) => setStage(event.target.value as StageFilter)}
            >
              <option value="all">Every stage</option>
              <option value="wired">Wired</option>
              <option value="declined">Declined</option>
              <option value="candidate">Not reviewed</option>
            </select>

            <span className={styles.count}>
              {rows.length} of {connectors.length}
            </span>
          </div>

          {isLoading ? (
            <SkeletonRows rows={10} columns={5} label="Loading the connector catalogue" />
          ) : (
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(row) => row.id}
              label="Data connectors"
              selectedKey={selectedId}
              onSelectedKeyChange={setSelectedId}
              onActivate={(row) => setOpenId(row.id)}
              emptyState={<p className={styles.empty}>Nothing matches those filters.</p>}
            />
          )}
        </Panel>

        {/*
          The disclaimer is part of the feature rather than boilerplate under it. A page listing
          exchange and broker APIs by name invites exactly the assumption this app does not
          support, and saying so once, here, is cheaper than the alternative.
        */}
        <p className={styles.disclaimer}>
          <Icon name="info" size={13} />
          <span>
            These are data sources and nothing else. Brew Terminal reads from them, shows you which
            one served every figure and how old it is, and never places an order, connects to a
            broker, or tells you what to buy or sell. Exchange and broker entries in this list refer
            to their market-data endpoints only.
          </span>
        </p>
      </div>

      <ConnectorDetail
        connector={open}
        onClose={() => setOpenId(null)}
        onOpenSettings={() => {
          setOpenId(null);
          void navigate('/settings/providers');
        }}
      />
    </>
  );
}

/** Wired first, then declined, then the queue — the order the catalogue is built in. */
const STAGE_ORDER: Record<ConnectorStage, number> = {
  wired: 0,
  declined: 1,
  candidate: 2,
};
