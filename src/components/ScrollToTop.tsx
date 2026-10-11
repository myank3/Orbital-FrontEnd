/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Resets window scroll on every route change.
 * Renders nothing — pure side-effect.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    // 'instant' bypasses smooth-scroll CSS so the jump feels native.
    // Falls back to plain scrollTo on older browsers.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, search]);

  return null;
}

export default ScrollToTop;