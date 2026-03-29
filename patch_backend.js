const fs = require('fs');
const file = 'e:/ServiZephyr_codebase/ServiZephyrTheRealBot/backend-standalone/frontend/src/app/owner-dashboard/layout.js';
let content = fs.readFileSync(file, 'utf8');

const searchString = `  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      setSidebarOpen(!mobile);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);`;

const replaceString = `  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
      } else {
        if (typeof window !== 'undefined' && window.location.pathname === '/owner-dashboard/manual-order') {
          setSidebarOpen(false);
        } else {
          setSidebarOpen(true);
        }
      }
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Auto-collapse sidebar based on pathname navigation
  useEffect(() => {
    if (!isMobile) {
      if (pathname === '/owner-dashboard/manual-order' || pathname.startsWith('/owner-dashboard/manual-order?')) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    }
  }, [pathname, isMobile]);`;

if (content.includes(searchString)) {
  fs.writeFileSync(file, content.replace(searchString, replaceString), 'utf8');
  console.log('PATCH_SUCCESS');
} else {
  console.error('PATCH_FAIL_NOT_FOUND');
}
