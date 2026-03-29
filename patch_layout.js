const fs = require('fs');
const file = 'e:/ServiZephyr_codebase/ServiZephyrTheRealBot/backend-standalone/frontend/src/app/owner-dashboard/layout.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /setIsMobile\(mobile\);\s+setSidebarOpen\(!mobile\);/g,
  `setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
      } else {
        if (typeof window !== 'undefined' && window.location.pathname === '/owner-dashboard/manual-order') {
          setSidebarOpen(false);
        } else {
          setSidebarOpen(true);
        }
      }`
);

content = content.replace(
  /  }, \[\]\);\s+\/\/ Track if we've given auth time to settle/g,
  `  }, []);

  // Auto-collapse sidebar based on pathname navigation
  useEffect(() => {
    if (!isMobile) {
      if (pathname === '/owner-dashboard/manual-order' || pathname.startsWith('/owner-dashboard/manual-order?')) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    }
  }, [pathname, isMobile]);

  // Track if we've given auth time to settle`
);

fs.writeFileSync(file, content, 'utf8');
console.log("PATCH COMPLETE");
