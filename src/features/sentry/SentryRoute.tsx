import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/status/Skeleton';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { RelativeTime } from '@/components/status/RelativeTime';
import { ipc } from '@/lib/ipc';
import type { SentryLayer } from '@/types/domain';
import { WorldMap } from './WorldMap';
import { LayerSidebar } from './LayerSidebar';
import { EconomyBoard } from './EconomyBoard';
import { InspectorHud } from './InspectorHud';
import { WatchList } from './WatchList';
import { RatesTicker } from './RatesTicker';
import { REFRESH_MS } from './constants';
import { WORLD_ATTRIBUTION } from './worldPath';
import styles from './SentryRoute.module.css';

/**
 * Sentry — a global trade and macro monitor.
 *
 * What it is, plainly: five public data sources drawn on one map, each labelled with where it
 * came from and how old it is, plus the distance from any hazard to the nearest strait, canal
 * or port. Nothing here forecasts, scores or ranks. The sources publish facts; this screen
 * arranges them.
 *
 * Everything it draws is free and public. Three of the five sources are government output in
 * the public domain, one is CC BY, and the fifth — freight aircraft — needs the reader's own
 * credentials because its licence does not permit a shipped product to poll it. That split is
 * the architecture, not an accident of what was available: a default install talks only to
 * services that are documented as free to use this way.
 */
export function SentryRoute() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyLayer, setBusyLayer] = useState<SentryLayer | null>(null);

  /**
   * Which layers are drawn.
   *
   * `null` means "whatever the sources say", which is the state on arrival. Once the reader
   * touches a toggle their choice takes over and a later refresh does not undo it. Deriving
   * rather than syncing in an effect is what keeps that true — an effect that copied the
   * server state into local state would fight the reader on every refresh.
   */
  const [override, setOverride] = useState<Set<SentryLayer> | null>(null);

  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['sentry'],
    queryFn: () => ipc('sentry_snapshot'),
    refetchInterval: REFRESH_MS,
    // A board nobody is looking at is a request nobody asked for — and these are free public
    // services, which is a reason to be careful with them rather than careless.
    refetchIntervalInBackground: false,
  });

  const layers = useMemo(() => data?.layers ?? [], [data]);

  const visible = useMemo(
    () => override ?? new Set(layers.filter((layer) => layer.enabled).map((layer) => layer.layer)),
    [override, layers],
  );

  const setEnabled = useMutation({
    mutationFn: (input: { providerId: string; enabled: boolean }) =>
      ipc('set_provider_enabled', input),
    onSettled: async () => {
      setBusyLayer(null);
      await queryClient.invalidateQueries({ queryKey: ['sentry'] });
      await queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const toggleLayer = useCallback(
    (layer: SentryLayer, next: boolean) => {
      // Visibility changes immediately; the source follows. Waiting for a round trip to redraw
      // a layer the reader just switched off makes the toggle feel broken.
      setOverride((current) => {
        const updated = new Set(current ?? visible);
        if (next) updated.add(layer);
        else updated.delete(layer);
        return updated;
      });

      const providerId = layers.find((status) => status.layer === layer)?.providerId;
      // The shipped geography has no source, so there is nothing to enable — hiding it is the
      // whole of the change.
      if (!providerId) return;

      setBusyLayer(layer);
      setEnabled.mutate({ providerId, enabled: next });
    },
    [layers, visible, setEnabled],
  );

  const markers = data?.markers ?? [];

  return (
    <>
      <WorkspaceHeader
        title="Sentry"
        subtitle="Trade, hazards and economies on one map"
        actions={
          <div className={styles.headerActions}>
            {dataUpdatedAt ? (
              <span className={styles.updated}>
                updated <RelativeTime epochSeconds={Math.floor(dataUpdatedAt / 1000)} /> · every{' '}
                {REFRESH_MS / 60_000} min
              </span>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => void refetch()}>
              Refresh now
            </Button>
          </div>
        }
      />

      <div className={styles.layout}>
        <div className={styles.left}>
          <Panel title="Near a chokepoint" className={styles.panel}>
            <WatchList
              proximities={data?.proximities ?? []}
              onSelect={setSelectedId}
              selectedId={selectedId}
            />
          </Panel>

          <Panel title="Economies" className={styles.panel} scroll>
            <EconomyBoard
              economies={data?.economies ?? []}
              onSelect={setSelectedId}
              selectedId={selectedId}
            />
          </Panel>
        </div>

        <div className={styles.centre}>
          {isLoading ? (
            <div className={styles.mapLoading}>
              <SkeletonRows rows={8} columns={2} label="Drawing the map" />
            </div>
          ) : (
            <WorldMap
              markers={markers}
              selectedId={selectedId}
              onSelect={setSelectedId}
              visible={visible}
            />
          )}
          <p className={styles.mapNote}>
            {WORLD_ATTRIBUTION} Equirectangular projection, so areas near the poles look larger than
            they are. Every distance in this feature is measured on the sphere, never off the
            picture.
          </p>

          {/*
            The layer controls sit under the map rather than in a rail, for two reasons. They
            belong next to the thing they change, and a world map is 2:1 — in a tall pane it
            can only ever be as wide as the pane allows, so the space beneath it is going spare
            whatever else happens.
          */}
          <Panel title="Layers" className={styles.layerPanel} scroll>
            {isLoading ? (
              <SkeletonRows rows={3} columns={2} label="Loading the layer list" />
            ) : (
              <LayerSidebar
                layers={layers}
                visible={visible}
                onToggle={toggleLayer}
                busy={busyLayer}
              />
            )}
          </Panel>
        </div>

        <div className={styles.right}>
          <Panel title="Inspector" className={styles.panel} scroll>
            <InspectorHud
              markers={markers}
              selectedId={selectedId}
              onSelect={setSelectedId}
              visible={visible}
            />
          </Panel>
        </div>

        <div className={styles.bottom}>
          <RatesTicker rates={data?.rates ?? []} layers={layers} />
          {/*
            The busy state lives here rather than over the map: a spinner covering the thing
            you are reading, every three minutes, is worse than a word in the corner.
          */}
          {isFetching && !isLoading ? (
            <p className={styles.refreshing} role="status" aria-live="polite">
              Refreshing
            </p>
          ) : null}
        </div>

        <div className={styles.disclaimer}>
          <DisclaimerNote />
        </div>
      </div>
    </>
  );
}
