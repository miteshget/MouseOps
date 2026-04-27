import React, { useRef, useEffect, useState } from 'react';

export default function LogPanel({ log, onExpand }) {
  const [open, setOpen] = useState(false);
  const preRef = useRef(null);

  useEffect(() => {
    if (open && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [log, open]);

  return (
    <details open={open} onToggle={e => setOpen(e.target.open)}
      className="border border-gray-800 rounded overflow-hidden">
      <summary className="flex items-center justify-between bg-gray-900 text-gray-400 px-3 py-1.5 text-xs cursor-pointer hover:text-green-400 transition-colors list-none select-none">
        <span>▶ Show logs</span>
        <button
          onClick={e => { e.preventDefault(); onExpand(); }}
          title="Expand full-screen"
          className="hover:text-green-300 text-lg leading-none"
        >⤢</button>
      </summary>
      <pre ref={preRef} className="log-pre">{log}</pre>
    </details>
  );
}
