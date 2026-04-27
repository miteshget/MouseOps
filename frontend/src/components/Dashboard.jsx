import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import CITile from './CITile';

export default function Dashboard({ onEdit, onOpenLog }) {
  const { cis, visibility } = useApp();

  const visibleCIs = useMemo(() => {
    if (!visibility) return cis;
    return visibility.order
      .map(id => cis.find(c => c.id === id))
      .filter(c => c && visibility.visible[c.id]);
  }, [cis, visibility]);

  if (cis.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
        <img src="/logo.png" alt="" className="w-16 h-16 rounded-full opacity-30" />
        <p className="text-lg font-semibold">No Showroom instances yet</p>
        <p className="text-sm">Click <strong>＋ Add Showroom</strong> to get started.</p>
      </div>
    );
  }

  if (visibleCIs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
        <p className="text-base font-medium">All tiles are hidden</p>
        <p className="text-sm">Toggle visibility in the left sidebar.</p>
      </div>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-4">
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
        {visibleCIs.map(ci => (
          <CITile
            key={ci.id}
            ci={ci}
            onEdit={() => onEdit(ci)}
            onOpenLog={onOpenLog}
          />
        ))}
      </div>
    </main>
  );
}
