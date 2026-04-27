import React, { useEffect, useRef } from 'react';

export default function LogModal({ title, content, onClose }) {
  const preRef = useRef(null);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [content]);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-gray-950 border border-gray-700 rounded-lg w-full max-w-4xl h-[82vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700 rounded-t-lg flex-shrink-0">
          <span className="font-mono text-xs text-gray-400">{title}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-lg leading-none transition-colors">✕</button>
        </div>
        <pre ref={preRef} className="flex-1 overflow-auto font-mono text-xs text-green-400 p-4 whitespace-pre-wrap break-all">
          {content || '(empty)'}
        </pre>
      </div>
    </div>
  );
}
