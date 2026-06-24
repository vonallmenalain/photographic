import { useEffect, useState } from 'react';
import { fetchAdminImage } from '../api/client';

/** Loads an admin-only (bearer-protected) thumbnail and shows it as an object URL. */
export function AdminThumb({ photoId, size = 120 }: { photoId: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let active = true;
    fetchAdminImage(`/api/admin/photos/${photoId}/thumb`)
      .then((u) => {
        if (active) {
          setUrl(u);
          revoked = u;
        } else {
          URL.revokeObjectURL(u);
        }
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [photoId]);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: 'var(--surface-2)',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      {url ? (
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : failed ? (
        <span className="muted" style={{ fontSize: '0.7rem' }}>
          ⏳
        </span>
      ) : (
        <span className="spinner" />
      )}
    </div>
  );
}
