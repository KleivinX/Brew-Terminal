import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { RelativeTime } from '@/components/status/RelativeTime';
import type { ConnectorInfo } from '@/types/domain';
import { AUTH_LABEL, RISK_TONE, STAGE_LABEL, STAGE_MEANING, statusLabel } from './labels';
import styles from './ConnectorDetail.module.css';

/**
 * Everything recorded about one connector.
 *
 * The shape of this panel is the argument the feature is making: for a wired source it fills
 * with limits, licence and attribution; for a candidate it is nearly empty and says so in
 * words. A reader should be able to tell at a glance how much this project actually knows,
 * rather than having to notice which fields happen to be blank.
 */

interface ConnectorDetailProps {
  connector: ConnectorInfo | null;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function ConnectorDetail({ connector, onClose, onOpenSettings }: ConnectorDetailProps) {
  return (
    <Modal
      open={connector !== null}
      onClose={onClose}
      title={connector?.displayName ?? 'Connector'}
      size="lg"
    >
      {connector ? <Body connector={connector} onOpenSettings={onOpenSettings} /> : null}
    </Modal>
  );
}

function Body({
  connector,
  onOpenSettings,
}: {
  connector: ConnectorInfo;
  onOpenSettings: () => void;
}) {
  return (
    <div className={styles.body}>
      <div className={styles.badges}>
        <span className={styles.badge} data-kind="category">
          {connector.categoryLabel}
        </span>
        <span className={styles.badge} data-stage={connector.stage}>
          {STAGE_LABEL[connector.stage]}
        </span>
        {connector.termsRisk ? (
          <span className={styles.badge} data-tone={RISK_TONE[connector.termsRisk]}>
            {connector.termsLabel}
          </span>
        ) : null}
      </div>

      <p className={styles.summary}>{connector.summary}</p>

      {/*
        The stage is explained in words on every connector, not just the awkward ones. Someone
        who has never read ADR-008 has no way to know that "Not reviewed" is a statement about
        this project rather than about the provider.
      */}
      <p className={styles.stageMeaning}>{STAGE_MEANING[connector.stage]}</p>

      <dl className={styles.facts}>
        <Fact label="Status" value={statusLabel(connector)} />
        {connector.auth ? <Fact label="Authentication" value={AUTH_LABEL[connector.auth]} /> : null}
        {connector.providerId ? (
          <Fact
            label="Provider id"
            value={connector.providerId}
            hint="The id that appears on every number this source served, so a figure on any screen can be traced back to this page."
            mono
          />
        ) : null}
        {connector.freeTier ? <Fact label="Free tier" value={connector.freeTier} /> : null}
        {connector.attribution ? <Fact label="Attribution" value={connector.attribution} /> : null}
        {connector.lastCheckedAt !== null ? (
          <Fact
            label="Last checked"
            value=""
            hint="When this provider last answered a check without an error. Written when a key is saved or “Test provider” is pressed — not on ordinary requests."
          >
            <RelativeTime epochSeconds={connector.lastCheckedAt} />
          </Fact>
        ) : null}
      </dl>

      {connector.note ? (
        <div className={styles.note} data-stage={connector.stage}>
          <Icon name={connector.stage === 'declined' ? 'warning' : 'info'} size={13} />
          <p>{connector.note}</p>
        </div>
      ) : null}

      <div className={styles.actions}>
        {connector.docsUrl ? (
          <a
            className={styles.docsLink}
            href={connector.docsUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Icon name="external" size={12} /> Official documentation
          </a>
        ) : null}

        {connector.userControllable ? (
          <Button size="sm" variant="secondary" onClick={onOpenSettings}>
            Configure in Settings
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  hint,
  mono,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>
        <span className={mono ? styles.mono : undefined}>{children ?? value}</span>
        {hint ? <span className={styles.factHint}>{hint}</span> : null}
      </dd>
    </div>
  );
}
