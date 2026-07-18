import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdateBanner() {
  const [show, setShow] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW() {
      // no-op
    },
  });

  useEffect(() => {
    setShow(needRefresh);
  }, [needRefresh]);

  if (!show) return null;
  return (
    <div className="update-banner">
      <span>A new version of the app is available.</span>
      <button
        type="button"
        className="primary"
        onClick={() => {
          void updateServiceWorker(true);
          setNeedRefresh(false);
        }}
      >
        Update
      </button>
    </div>
  );
}
