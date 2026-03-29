const fs = require('fs');

const file = 'e:/ServiZephyr_codebase/ServiZephyrTheRealBot/src/app/owner-dashboard/manual-order/page.js';
let content = fs.readFileSync(file, 'utf8');

// 1. Add isMounted to state declarations
const stateTarget = \`    // Category Drag & Drop State
    const [categoryOrder, setCategoryOrder] = useState([]);\`.replace(/\\r\\n/g, '\\n');

const stateReplacement = \`    // Category Drag & Drop State
    const [isMounted, setIsMounted] = useState(false);
    const [categoryOrder, setCategoryOrder] = useState([]);\`.replace(/\\r\\n/g, '\\n');

content = content.replace(/\\r\\n/g, '\\n');
if (content.includes(stateTarget)) {
  content = content.replace(stateTarget, stateReplacement);
} else {
  console.log('Failed to match state target');
}

// 2. Add setIsMounted to useEffect
const effectTarget = \`    useEffect(() => {
        if (typeof window === 'undefined') return;
        const uid = impersonatedOwnerId || employeeOfOwnerId || auth?.currentUser?.uid || 'default';\`.replace(/\\r\\n/g, '\\n');

const effectReplacement = \`    useEffect(() => {
        setIsMounted(true);
        if (typeof window === 'undefined') return;
        const uid = impersonatedOwnerId || employeeOfOwnerId || auth?.currentUser?.uid || 'default';\`.replace(/\\r\\n/g, '\\n');

if (content.includes(effectTarget)) {
  content = content.replace(effectTarget, effectReplacement);
} else {
  console.log('Failed to match effect target');
}

// 3. Replace the categories mapping rendering with DND wrapper
const mapTarget = \`                                <div className="space-y-1">
                                    {visibleMenuEntries.map(([categoryId]) => (
                                        <button
                                            key={categoryId}
                                            onClick={() => scrollToCategory(categoryId)}
                                            className={cn(
                                                "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all capitalize",
                                                activeCategory === categoryId
                                                    ? "bg-primary text-primary-foreground shadow-md scale-[1.02]"
                                                    : "text-muted-foreground hover:bg-muted"
                                            )}
                                        >
                                            {formatCategoryLabel(categoryId)}
                                        </button>
                                    ))}
                                </div>\`.replace(/\\r\\n/g, '\\n');

const mapReplacement = \`                                <DragDropContext onDragEnd={onCategoryDragEnd}>
                                    <Droppable droppableId="manual-categories">
                                        {(provided) => {
                                            const sortedMenuEntries = [...visibleMenuEntries].sort((a, b) => {
                                                if (categoryOrder.length === 0) return 0;
                                                const idxA = categoryOrder.indexOf(a[0]);
                                                const idxB = categoryOrder.indexOf(b[0]);
                                                if (idxA === -1 && idxB === -1) return 0;
                                                if (idxA === -1) return 1;
                                                if (idxB === -1) return -1;
                                                return idxA - idxB;
                                            });

                                            return (
                                                <div className="space-y-1.5 p-1" ref={provided.innerRef} {...provided.droppableProps}>
                                                    {isMounted && sortedMenuEntries.map(([categoryId], index) => (
                                                        <Draggable key={\\\`cat-\\\${categoryId}\\\`} draggableId={\\\`cat-\\\${categoryId}\\\`} index={index}>
                                                            {(provided, snapshot) => (
                                                                <div
                                                                    ref={provided.innerRef}
                                                                    {...provided.draggableProps}
                                                                    className="relative flex items-center group mb-1 border-2 border-border/60 rounded-lg overflow-hidden bg-background"
                                                                    style={{ ...provided.draggableProps.style }}
                                                                >
                                                                    <div
                                                                        {...provided.dragHandleProps}
                                                                        className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center bg-muted/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing border-r border-border/50 text-muted-foreground z-10"
                                                                    >
                                                                        <GripVertical size={16} />
                                                                    </div>
                                                                    <button
                                                                        onClick={() => scrollToCategory(categoryId)}
                                                                        className={cn(
                                                                            "w-full text-left pl-7 pr-3 py-3 text-base font-semibold transition-all capitalize",
                                                                            activeCategory === categoryId
                                                                                ? "bg-primary text-primary-foreground shadow-sm"
                                                                                : "text-muted-foreground hover:bg-muted/50"
                                                                        )}
                                                                    >
                                                                        {formatCategoryLabel(categoryId)}
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            );
                                        }}
                                    </Droppable>
                                </DragDropContext>\`.replace(/\\r\\n/g, '\\n');

if (content.includes(mapTarget)) {
  content = content.replace(mapTarget, mapReplacement);
} else {
  console.log('Failed to match map target');
}

fs.writeFileSync(file, content, 'utf8');
console.log('Patch complete.');
