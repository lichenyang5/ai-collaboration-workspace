import { useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useRealtime } from './RealtimeProvider';

const NOTIFICATION_TIMEOUT_MS = 5_000;

export function RealtimeNotificationCenter() {
  const { notifications, dismissNotification } = useRealtime();
  const notification = notifications[0];
  const eventId = notification?.eventId;

  const dismissCurrent = useCallback(() => {
    if (eventId) {
      dismissNotification(eventId);
    }
  }, [dismissNotification, eventId]);

  useEffect(() => {
    if (!eventId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      dismissNotification(eventId);
    }, NOTIFICATION_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [dismissNotification, eventId]);

  if (!notification) {
    return null;
  }

  return (
    <aside className="realtime-notification" role="status" aria-live="polite">
      <p>你已加入「{notification.teamName}」</p>
      <div className="realtime-notification-actions">
        <Link to={`/teams/${notification.teamId}/projects`} onClick={dismissCurrent}>
          查看团队
        </Link>
        <button type="button" onClick={dismissCurrent} aria-label="关闭团队邀请通知">
          关闭
        </button>
      </div>
    </aside>
  );
}
