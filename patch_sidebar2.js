const fs = require('fs');

const file = 'e:/ServiZephyr_codebase/ServiZephyrTheRealBot/src/components/OwnerDashboard/Sidebar.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Imports
const importsTarget = \`  UserCircle,
  FilePlus,
} from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import SidebarLink from "./SidebarLink";
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { auth, db } from '@/lib/firebase';\`.replace(/\\r\\n/g, '\\n');

const importsReplacement = \`  UserCircle,
  FilePlus,
  GripVertical
} from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import SidebarLink from "./SidebarLink";
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { auth, db } from '@/lib/firebase';\`.replace(/\\r\\n/g, '\\n');

content = content.replace(/\\r\\n/g, '\\n'); // normalize to LF for matching
if(content.includes(importsTarget)) {
  content = content.replace(importsTarget, importsReplacement);
} else {
  console.log('Failed to match imports');
}

// 2. State & Filtering
const stateTarget = \`  // If role is still pending for employee, show empty menus to prevent flash
  const menuItems = isRolePending ? [] : allMenuItems.filter(item => canAccessPage(effectiveRole, item.featureId, customAllowedPages, businessType));
  const settingsItems = isRolePending ? [] : allSettingsItems.filter(item => canAccessPage(effectiveRole, item.featureId, customAllowedPages, businessType));\`.replace(/\\r\\n/g, '\\n');

const stateReplacement = \`  const [isMounted, setIsMounted] = useState(false);
  const [menuOrder, setMenuOrder] = useState([]);
  const [settingsOrder, setSettingsOrder] = useState([]);

  useEffect(() => {
    setIsMounted(true);
    if (typeof window === 'undefined') return;
    const uid = effectiveOwnerId || auth?.currentUser?.uid || 'default';
    try {
      const savedMenu = localStorage.getItem(\\\`sidebar_menu_order_\\$\{uid}\\\`);
      if (savedMenu) setMenuOrder(JSON.parse(savedMenu));
      const savedSettings = localStorage.getItem(\\\`sidebar_settings_order_\\$\{uid}\\\`);
      if (savedSettings) setSettingsOrder(JSON.parse(savedSettings));
    } catch (e) { }
  }, [effectiveOwnerId]);

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const { source, destination, droppableId } = result;

    if (droppableId === 'menu') {
      const items = Array.from(sortedMenuItems);
      const [reorderedItem] = items.splice(source.index, 1);
      items.splice(destination.index, 0, reorderedItem);
      const newOrder = items.map(i => i.featureId);
      setMenuOrder(newOrder);
      const uid = effectiveOwnerId || auth.currentUser?.uid || 'default';
      localStorage.setItem(\\\`sidebar_menu_order_\\$\{uid}\\\`, JSON.stringify(newOrder));
    } else if (droppableId === 'settings') {
      const items = Array.from(sortedSettingsItems);
      const [reorderedItem] = items.splice(source.index, 1);
      items.splice(destination.index, 0, reorderedItem);
      const newOrder = items.map(i => i.featureId);
      setSettingsOrder(newOrder);
      const uid = effectiveOwnerId || auth.currentUser?.uid || 'default';
      localStorage.setItem(\\\`sidebar_settings_order_\\$\{uid}\\\`, JSON.stringify(newOrder));
    }
  };

  const getSortedItems = (items, order) => {
    if (!order || order.length === 0) return items;
    return [...items].sort((a, b) => {
      const indexA = order.indexOf(a.featureId);
      const indexB = order.indexOf(b.featureId);
      if (indexA === -1 && indexB === -1) return 0;
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
  };

  // 1. Filter out locked/disabled features entirely. 2. Filter by permissions
  const visibleMenuItems = isRolePending ? [] : allMenuItems.filter(item => !getIsDisabled(item.featureId) && canAccessPage(effectiveRole, item.featureId, customAllowedPages, businessType));
  const visibleSettingsItems = isRolePending ? [] : allSettingsItems.filter(item => !getIsDisabled(item.featureId) && canAccessPage(effectiveRole, item.featureId, customAllowedPages, businessType));

  const sortedMenuItems = getSortedItems(visibleMenuItems, menuOrder);
  const sortedSettingsItems = getSortedItems(visibleSettingsItems, settingsOrder);\`.replace(/\\r\\n/g, '\\n');

if(content.includes(stateTarget)) {
  content = content.replace(stateTarget, stateReplacement);
} else {
  console.log('Failed to match state');
}

// 3. Render
const renderTarget = \`      <nav className={styles.sidebarNav}>
        <div className={styles.menuGroup}>
          <span className={\\\`\\\${styles.menuGroupTitle} \\\${isCollapsed ? styles.collapsedText : ''}\\\`}>Menu</span>
          {menuItems.map((item) => (
            <div key={item.name} onClick={handleLinkClick}>
              <SidebarLink
                item={{
                  ...item,
                  badge: item.featureId === 'whatsapp-direct'
                    ? whatsappUnreadCount
                    : item.featureId === 'live-orders'
                      ? pendingOrdersCount
                      : item.featureId === 'dine-in'
                        ? (dineInPendingOrdersCount + dineInServiceRequestsCount)
                        : item.featureId === 'bookings'
                          ? waitlistEntriesCount
                          : 0
                }}
                isCollapsed={isCollapsed}
                isDisabled={getIsDisabled(item.featureId)}
                disabledIcon={Lock}
                disabledMessage={\\\`\\\${item.name} is not available for your account. Please contact support for more information.\\\`}
              />
            </div>
          ))}
        </div>
        <div className={styles.menuGroup}>
          <span className={\\\`\\\${styles.menuGroupTitle} \\\${isCollapsed ? styles.collapsedText : ''}\\\`}>General</span>
          {settingsItems.map((item) => (
            <div key={item.name} onClick={handleLinkClick}>
              <SidebarLink
                item={item}
                isCollapsed={isCollapsed}
                isDisabled={getIsDisabled(item.featureId)}
                disabledIcon={Lock}
                disabledMessage={\\\`\\\${item.name} is not available for your account. Please contact support for more information.\\\`}
              />
            </div>
          ))}
        </div>
      </nav>\`.replace(/\\r\\n/g, '\\n');

const renderReplacement = \`      <nav className={styles.sidebarNav}>
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="menu">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className={styles.menuGroup}>
                <span className={\\\`\\\${styles.menuGroupTitle} \\\${isCollapsed ? styles.collapsedText : ''}\\\`}>Menu</span>
                {isMounted && sortedMenuItems.map((item, index) => (
                  <Draggable key={item.featureId} draggableId={\\\`menu-\\\${item.featureId}\\\`} index={index} isDragDisabled={isCollapsed}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className="relative flex items-center group cursor-default"
                        style={{ ...provided.draggableProps.style }}
                      >
                        <div
                          {...provided.dragHandleProps}
                          className={\\\`absolute left-1 z-10 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-muted-foreground \\\${isCollapsed ? 'hidden' : 'block'}\\\`}
                        >
                          <GripVertical size={16} />
                        </div>
                        <div className="flex-1 w-full" onClick={handleLinkClick}>
                          <SidebarLink
                            item={{
                              ...item,
                              badge: item.featureId === 'whatsapp-direct'
                                ? whatsappUnreadCount
                                : item.featureId === 'live-orders'
                                  ? pendingOrdersCount
                                  : item.featureId === 'dine-in'
                                    ? (dineInPendingOrdersCount + dineInServiceRequestsCount)
                                    : item.featureId === 'bookings'
                                      ? waitlistEntriesCount
                                      : 0
                            }}
                            isCollapsed={isCollapsed}
                            isDisabled={false} // Hidden if disabled, never rendered
                          />
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>

          <Droppable droppableId="settings">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className={styles.menuGroup}>
                <span className={\\\`\\\${styles.menuGroupTitle} \\\${isCollapsed ? styles.collapsedText : ''}\\\`}>General</span>
                {isMounted && sortedSettingsItems.map((item, index) => (
                  <Draggable key={item.featureId} draggableId={\\\`settings-\\\${item.featureId}\\\`} index={index} isDragDisabled={isCollapsed}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className="relative flex items-center group cursor-default"
                        style={{ ...provided.draggableProps.style }}
                      >
                        <div
                          {...provided.dragHandleProps}
                          className={\\\`absolute left-1 z-10 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-muted-foreground \\\${isCollapsed ? 'hidden' : 'block'}\\\`}
                        >
                          <GripVertical size={16} />
                        </div>
                        <div className="flex-1 w-full" onClick={handleLinkClick}>
                          <SidebarLink
                            item={item}
                            isCollapsed={isCollapsed}
                            isDisabled={false}
                          />
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </nav>\`.replace(/\\r\\n/g, '\\n');

if(content.includes(renderTarget)) {
  content = content.replace(renderTarget, renderReplacement);
} else {
  console.log('Failed to match render');
}

fs.writeFileSync(file, content, 'utf8');
console.log('PATCH COMPLETE!');
