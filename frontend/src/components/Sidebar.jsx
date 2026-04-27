import React, { useState, useMemo } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp } from '../context/AppContext';


export default function Sidebar({ open, onOpenAdd }) {
  const { cis, visibility, setModuleVisible, setAllVisible, reorderTiles, readonly, user } = useApp();
  const canWrite = !readonly && user?.role === 'admin';
  const [search, setSearch] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const ordered = useMemo(() => {
    if (!visibility) return cis;
    return visibility.order
      .map(id => cis.find(c => c.id === id))
      .filter(Boolean);
  }, [cis, visibility]);

  const filtered = useMemo(() =>
    search.trim()
      ? ordered.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.url.toLowerCase().includes(search.toLowerCase()))
      : ordered,
    [ordered, search]
  );

  const visibleCount = visibility
    ? Object.values(visibility.visible).filter(Boolean).length
    : cis.length;

  const allVisible = visibleCount === cis.length;
  const noneVisible = visibleCount === 0;

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = ordered.findIndex(c => c.id === active.id);
    const newIdx = ordered.findIndex(c => c.id === over.id);
    if (oldIdx >= 0 && newIdx >= 0) {
      reorderTiles(arrayMove(ordered, oldIdx, newIdx).map(c => c.id));
    }
  }

  return (
    <aside
      className={`flex flex-col bg-gray-900 text-gray-100 flex-shrink-0 transition-all duration-300 overflow-hidden ${open ? 'w-64' : 'w-0'}`}
      style={{ minWidth: open ? 256 : 0 }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400">CI Instances</span>
          <span className="text-xs text-gray-500">{visibleCount}/{cis.length}</span>
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search CIs…"
            className="w-full bg-gray-800 text-gray-200 text-xs pl-7 pr-3 py-1.5 rounded border border-gray-700 focus:outline-none focus:border-blue-500 placeholder-gray-600"
          />
        </div>

        {/* Select all / none */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => setAllVisible(true)}
            disabled={allVisible}
            className="flex-1 text-xs py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            All
          </button>
          <button
            onClick={() => setAllVisible(false)}
            disabled={noneVisible}
            className="flex-1 text-xs py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            None
          </button>
        </div>
      </div>

      {/* Tile list */}
      <div className="flex-1 overflow-y-auto py-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filtered.map(c => c.id)} strategy={verticalListSortingStrategy}>
            {filtered.map(ci => (
              <SortableItem
                key={ci.id}
                ci={ci}
                visible={visibility?.visible[ci.id] ?? true}
                onToggle={v => setModuleVisible(ci.id, v)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {filtered.length === 0 && (
          <p className="text-xs text-gray-600 text-center mt-6 px-4">
            {search ? 'No CIs match your search.' : 'No CI instances added yet.'}
          </p>
        )}
      </div>

      {/* Footer — only shown to admins */}
      {canWrite && (
        <div className="px-3 py-3 border-t border-gray-700">
          <button
            onClick={onOpenAdd}
            className="w-full flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold py-2 rounded transition-colors"
          >
            <span>＋</span> Add CI
          </button>
        </div>
      )}
    </aside>
  );
}

function SortableItem({ ci, visible, onToggle }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ci.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const shortUrl = ci.url.replace(/^https?:\/\//, '');

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-800 transition-colors border-l-2 ${visible ? 'border-blue-500' : 'border-transparent'}`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing flex-shrink-0"
        tabIndex={-1}
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
        </svg>
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0" onClick={() => onToggle(!visible)}>
        <p className={`text-xs font-medium truncate ${visible ? 'text-gray-100' : 'text-gray-500'}`}>{ci.name}</p>
        <p className="text-xs text-gray-600 truncate">{shortUrl}</p>
      </div>

      {/* Toggle */}
      <button
        onClick={() => onToggle(!visible)}
        className={`w-8 h-4 rounded-full flex-shrink-0 relative transition-colors ${visible ? 'bg-blue-500' : 'bg-gray-700'}`}
      >
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${visible ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
