import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { RelativeTime } from '@/components/status/RelativeTime';
import type { AiConversation } from '@/types/domain';
import styles from './ConversationList.module.css';

interface ConversationListProps {
  conversations: AiConversation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

/**
 * Local history, with the two deletions Phase 5 requires: one conversation, or all of them.
 *
 * Neither removes anything from the outbound log. That record says data left the machine, and
 * tidying a transcript is not the same act as erasing the evidence — the Privacy page clears
 * the log separately, and says so. See AI_POLICY.md §2.4.
 */
export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onDelete,
  onClearAll,
}: ConversationListProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <Button size="sm" variant="secondary" onClick={() => onSelect(null)}>
          New conversation
        </Button>
      </div>

      {conversations.length === 0 ? (
        <p className={styles.empty}>Conversations are stored on this computer only.</p>
      ) : (
        <ul className={styles.list} role="list">
          {conversations.map((conversation) => {
            const selected = conversation.id === selectedId;
            return (
              <li key={conversation.id} className={styles.row}>
                <button
                  type="button"
                  className={[styles.select, selected ? styles.selected : null]
                    .filter(Boolean)
                    .join(' ')}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(conversation.id)}
                >
                  <span className={styles.title}>{conversation.title}</span>
                  <span className={styles.meta}>
                    <RelativeTime epochSeconds={conversation.updatedAt} />
                    {conversation.modelName ? ` · ${conversation.modelName}` : ''}
                  </span>
                </button>

                <button
                  type="button"
                  className={styles.delete}
                  onClick={() => onDelete(conversation.id)}
                  aria-label={`Delete conversation: ${conversation.title}`}
                >
                  <Icon name="trash" size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {conversations.length > 0 ? (
        <div className={styles.foot}>
          <Button size="sm" variant="ghost" onClick={onClearAll}>
            Delete all conversations
          </Button>
        </div>
      ) : null}
    </div>
  );
}
