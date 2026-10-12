import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, X } from 'lucide-react';

export const Terminal: React.FC = () => {
  const [output, setOutput] = useState<string[]>(['> Chào mừng đến với Lumina Terminal. Gõ help để xem các lệnh khả dụng.']);
  const [input, setInput] = useState('');
  const outputEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [output]);

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const cmd = input.trim();
    setOutput((prev) => [...prev, `> ${cmd}`]);
    setInput('');

    try {
      const response = await fetch('/api/terminal/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });

      const data = await response.json();
      if (data.output) {
        setOutput((prev) => [...prev, ...data.output.split('\n')]);
      } else if (data.error) {
        setOutput((prev) => [...prev, `Error: ${data.error}`]);
      }
    } catch (err) {
      setOutput((prev) => [...prev, `Lỗi kết nối: ${err}`]);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 p-4 font-mono text-xs text-slate-300">
      <div className="flex-1 overflow-y-auto mb-4 space-y-1">
        {output.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
        <div ref={outputEndRef} />
      </div>
      <form onSubmit={handleCommand} className="flex items-center gap-2">
        <span className="text-blue-500">$</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-slate-100"
          placeholder="Nhập lệnh..."
          autoFocus
        />
      </form>
    </div>
  );
};
